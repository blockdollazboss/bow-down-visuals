import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  CREDIT_PACKS,
  PACKS_TEST_MODE_NOTE,
  apiErrorLine,
  packCheckoutPayload,
  packCheckoutUrl,
  type CreditPack,
} from "@/lib/world/money-desks";
import { CHECKOUT_TRANSFER_LABEL } from "@/lib/world/shop-stands";

/* ─── PacksDesk — Buy Visual Bucs in the Treasury (Stack-100 #61) ──
   The packs desk: the four real credit packs, priced exactly as
   the pricing page prices them (lib/world/money-desks CREDIT_PACKS
   — pinned against the server's PACK_MAP and the page's own
   displayed prices). Buying rides the page's own rail:
   POST /api/create-checkout-session { pack } answers the hosted
   Stripe checkout URL, which opens in a NEW TAB (the stands' one
   sanctioned transfer, §3.9) — the palace tab, the room and the
   walker's place in it never move, and the balance refreshes when
   they come back (the panel re-reads the profile on focus, like
   the Crowns stand refreshes memberships). The desk is a
   members-only Treasury station: guests meet the station's pitch
   and the sign-in ask before this panel ever renders, so an
   out-of-credits state is a door now, never a dead end. The
   test-mode honesty line rides on top, exactly as the pricing
   page carries it — payments are in test mode today. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

export function PacksDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const { profile, refreshProfile } = useAuth();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const balance = typeof profile?.credits === "number" ? profile.credits : null;

  const buy = async (pack: CreditPack) => {
    if (busyKey) return;
    setBusyKey(pack.key);
    setNote(null);
    setFailed(null);
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(packCheckoutPayload(pack)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Checkout failed. Please try again."));
      const url = packCheckoutUrl(data);
      if (!url) throw new Error("Checkout didn't return a payment page — nothing was charged.");
      window.open(url, "_blank", "noopener,noreferrer");
      setNote(
        `Checkout for ${pack.creditsLabel} opened in a new tab — finish paying there. Your Visual Bucs land the moment the payment confirms; this desk refreshes your balance when you're back.`,
      );
      /* Coming back from the hosted tab: re-read the profile so a
         landed grant shows on the desk (and everywhere else). */
      const onFocus = () => {
        refreshProfile();
        window.removeEventListener("focus", onFocus);
      };
      window.addEventListener("focus", onFocus);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Network error. Please try again.");
    } finally {
      setBusyKey(null);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <div className="space-y-3" data-testid="world-treasury-packs">
      <NativeCard isLight={isLight} title="Visual Buc packs">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className={`text-xs ${muted}`}>
            Top up right here — the same packs, the same prices, the same checkout as the website.
          </p>
          {balance !== null && (
            <span className={`ml-auto text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              Your balance: {balance.toLocaleString("en-US")} Visual Bucs
            </span>
          )}
        </div>
        <p className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isLight ? "border-amber-600/30 bg-amber-400/10 text-[#92600a]" : "border-yellow-500/20 bg-yellow-500/[0.06] text-yellow-200/80"}`}>
          {PACKS_TEST_MODE_NOTE}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {CREDIT_PACKS.map((pack) => (
            <div
              key={pack.key}
              data-testid={`world-pack-${pack.key}`}
              className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center ${
                isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
              }`}
            >
              <CreditCard className="h-5 w-5 text-[#d4af37]" />
              <span className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{pack.creditsLabel}</span>
              <span className="text-xl font-black text-[#d4af37]">{pack.priceLabel}</span>
              <button
                type="button"
                data-testid={`world-pack-buy-${pack.key}`}
                onClick={() => void buy(pack)}
                disabled={busyKey !== null}
                className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
              >
                {busyKey === pack.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                {busyKey === pack.key ? "Processing…" : CHECKOUT_TRANSFER_LABEL}
              </button>
            </div>
          ))}
        </div>
        {note && <p className={`mt-3 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
        {failed && <p className="mt-3 text-xs font-semibold text-red-400">{failed}</p>}
      </NativeCard>
    </div>
  );
}
