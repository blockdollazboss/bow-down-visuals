import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { balanceComposition } from "@/lib/balance";
import { TemporaryBucsNote } from "@/components/BalanceBreakdown";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  CREDIT_PACKS,
  apiErrorLine,
  packCheckoutPayload,
  packCheckoutUrl,
  type CreditPack,
} from "@/lib/world/money-desks";
import { EmbeddedPaymentForm, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import { checkoutFailureCopy } from "@/lib/checkout-fetch";

/* ─── PacksDesk — Buy Visual Bucs in the Treasury (Stack-100 #61) ──
   The packs desk: the four real credit packs, priced exactly as
   the pricing page prices them (lib/world/money-desks CREDIT_PACKS
   — pinned against the server's PACK_MAP and the page's own
   displayed prices). JOIN2 MONEY MOMENT: the desk now consumes the
   embedded checkout form (orphan embedded-checkout lane) — with a
   publishable key present, Buy opens the on-page PaymentElement
   form right in this desk via POST /api/embedded-checkout/
   credit-pack/intent and confirms through its /verify twin, so the
   walker never leaves the palace at all. The hosted rail remains
   the fallback when no key is configured: POST
   /api/create-checkout-session { pack } answers the hosted Stripe
   checkout URL, which opens in a NEW TAB (the stands' one
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
  const { t, i18n } = useTranslation();
  const authHeaders = useAuthHeaders();
  const { profile, refreshProfile } = useAuth();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState<{ packKey: string; clientSecret: string; label: string } | null>(null);

  const balance = typeof profile?.credits === "number" ? profile.credits : null;

  /* Lane V-bucs remainder (stack700): the balance line keeps the
     single spendable total; while part of it is temporary, the split
     rides under it — Permanent on its own line, the temporary part
     named with its expiry on the next. Same source as every shipped
     surface (lib/balance composition over the session profile — the
     one aggregate bonus pool with one expiry), same balance.*
     strings the Studio board already renders in-world. */
  const composition = profile
    ? (profile.balance_composition ?? balanceComposition(profile))
    : null;

  /* Embedded confirm: the PaymentIntent succeeded in the form — the
     /verify twin grants the Bucs server-side (the webhook is the
     second door to the same exactly-once grant). */
  const confirmEmbedded = async (paymentIntentId: string) => {
    try {
      const res = await fetch("/api/embedded-checkout/credit-pack/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ paymentIntentId }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !data.success) {
        setFailed(apiErrorMessage(data, t("worldRemainder.pakConfirming")));
        return;
      }
      setEmbedded(null);
      setNote(t("worldRemainder.pakAdded", { amount: (typeof data.added === "number" ? data.added : 0).toLocaleString(i18n.language) }));
      refreshProfile();
    } catch {
      setFailed(t("worldRemainder.pakConfirming"));
    }
  };

  const buy = async (pack: CreditPack) => {
    if (busyKey) return;
    setBusyKey(pack.key);
    setNote(null);
    setFailed(null);
    try {
      /* JOIN2: embedded first (never leave the site) — the intent
         answers a clientSecret and the desk mounts the shared form.
         HONESTY (stack1400 ruling #18, mirroring PlansDesk and the
         pricing page): ANY intent failure STOPS here with the
         honest error — a server answer shows its message, or names
         its HTTP status with the nothing-charged line when it sent
         none; an OK answer with no usable secret is a failed start,
         named as such; and a transport failure is named by
         checkoutFailureCopy. The desk NEVER falls through to the hosted rail
         on a failed intent: leaving for a hosted page on an error breaks
         never-leave-the-site. The hosted rail below
         serves ONLY the no-publishable-key configuration,
         where embedded checkout cannot run at all. */
      if (hasStripePublishableKey()) {
        try {
          const ires = await fetch("/api/embedded-checkout/credit-pack/intent", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authHeaders()) },
            body: JSON.stringify(packCheckoutPayload(pack)),
          });
          const idata = (await ires.json().catch(() => ({}))) as Record<string, unknown>;
          if (ires.ok && typeof idata.clientSecret === "string") {
            setEmbedded({ packKey: pack.key, clientSecret: idata.clientSecret, label: `${pack.creditsLabel} — ${pack.priceLabel}` });
            return;
          }
          if (ires.ok) {
            setFailed(t("worldRemainder.pakCheckoutDidntStart"));
            return;
          }
          setFailed(
            apiErrorMessage(
              idata,
              t("worldRemainder.pakServerError", { status: ires.status }),
            ),
          );
          return;
        } catch (err) {
          setFailed(checkoutFailureCopy(err, { serverError: (status) => t("worldRemainder.pakServerError", { status }), unreachable: t("worldRemainder.pakUnreachable") }));
          return;
        }
      }
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(packCheckoutPayload(pack)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldRemainder.pakCheckoutFailed")));
      const url = packCheckoutUrl(data);
      if (!url) throw new Error(t("worldRemainder.pakNoPaymentPage"));
      window.open(url, "_blank", "noopener,noreferrer");
      setNote(t("worldRemainder.pakHostedNote", { label: pack.creditsLabel }));
      /* Coming back from the hosted tab: re-read the profile so a
         landed grant shows on the desk (and everywhere else). */
      const onFocus = () => {
        refreshProfile();
        window.removeEventListener("focus", onFocus);
      };
      window.addEventListener("focus", onFocus);
    } catch (e) {
      setFailed(plainErrorText(e, t("worldRemainder.pakNetworkError")));
    } finally {
      setBusyKey(null);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <div className="space-y-3" data-testid="world-treasury-packs">
      <NativeCard isLight={isLight} title={t("worldRemainder.pakTitle")}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className={`text-xs ${muted}`}>
            {t("worldRemainder.pakIntro")}
          </p>
          {balance !== null && (
            <span className={`ml-auto text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {t("worldRemainder.pakBalance", { amount: balance.toLocaleString(i18n.language) })}
            </span>
          )}
        </div>
        {composition && composition.temporaryCredits > 0 && (
          <div className="mt-1.5 flex flex-col items-end gap-0.5" data-testid="world-packs-balance-split">
            <span className={`text-xs ${muted}`}>
              {t("balance.permanent_amount", { amount: composition.permanentCredits.toLocaleString(i18n.language) })}
            </span>
            <TemporaryBucsNote
              composition={composition}
              mode="label"
              className={`text-xs font-bold ${isLight ? "text-[#8a6d1f]" : "text-amber-300/90"}`}
            />
          </div>
        )}
        <p className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isLight ? "border-amber-600/30 bg-amber-400/10 text-[#92600a]" : "border-yellow-500/20 bg-yellow-500/[0.06] text-yellow-200/80"}`}>
          {t("worldRemainder.pakTestModeNote")}
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
                className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
              >
                {busyKey === pack.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                {busyKey === pack.key ? t("worldRemainder.pakProcessing") : t("worldRemainder.pakCheckoutTransfer")}
              </button>
            </div>
          ))}
        </div>
        {embedded && (
          <div className="mt-4" data-testid="world-packs-embedded">
            <p className={`mb-2 text-center text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {t("worldRemainder.pakFinishHere", { label: embedded.label })}
            </p>
            <EmbeddedPaymentForm
              clientSecret={embedded.clientSecret}
              submitLabel={embedded.label}
              onConfirmed={confirmEmbedded}
              onError={(msg) => setFailed(msg)}
            />
            <button
              type="button"
              onClick={() => setEmbedded(null)}
              className={`mt-2 w-full text-center text-xs bdv-touch-target ${isLight ? "text-[#6B5B36] hover:text-[#2a1e07]" : "text-white/40 hover:text-white/70"}`}
            >
              {t("worldRemainder.pakCancelNoCharge")}
            </button>
          </div>
        )}
        {note && <p className={`mt-3 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
        {failed && <p className="mt-3 text-xs font-semibold text-red-400">{failed}</p>}
      </NativeCard>
    </div>
  );
}
