import { plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight, CheckCircle2, CircleDollarSign, ExternalLink, Loader2, RotateCcw, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  apiErrorLine,
  canCashOut,
  parseConnectStatus,
  payoutDeskState,
  payoutDollars,
  payoutSuccessNote,
  type ConnectStatusDto,
} from "@/lib/world/money-desks";

/* ─── PayoutDesk — cash out from the Get Paid Room (Stack-100 #62) ─
   The seller dashboard's Get Paid card (store-dashboard.tsx
   ConnectPayoutCard), at the palace's money desk — the SAME rails,
   the same states, the same words where the words are the rail's:
   GET /api/connect/status for the truth, POST /api/connect/onboard
   and /connect/refresh for Stripe's hosted bank setup (the one
   sanctioned exit — bank onboarding is hosted BY DESIGN, exactly
   as on the website; the hosted page opens in a new tab so the
   palace never moves), and POST /api/connect/payout to cash out
   the pending balance. Cash-out is the walker's OWN earnings —
   the site pays nobody here; creators collect what their work
   earned. The desk renders only for members (the board above it
   already pitches guests), and a member without a creator profile
   gets the honest line, not a broken card: the rail 404s
   NO_PROFILE for them, exactly as the dashboard card hides.
   Returning from the hosted tab re-reads the status on focus —
   the webhook may land a beat after Stripe lets go. Test mode is
   labelled wherever the rail says it is, never hidden. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

export function PayoutDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [status, setStatus] = useState<ConnectStatusDto | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"connect" | "payout" | null>(null);
  const [confirmingPayout, setConfirmingPayout] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connect/status", { headers: await authHeaders() });
      if (res.status === 404) {
        setNoProfile(true);
        return;
      }
      if (res.status === 503) {
        setNotConfigured(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.poLoadStatusError")));
      const parsed = parseConnectStatus(data);
      if (!parsed) throw new Error(t("worldCoachMoney.poLoadStatusError"));
      setStatus(parsed);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Back from Stripe's hosted setup tab: re-check the status when
     the palace tab takes focus again (the dashboard waits a beat
     for the account.updated webhook the same way). */
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void load(), 1500);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (t) clearTimeout(t);
    };
  }, [load]);

  const goOnboard = async (path: "/api/connect/onboard" | "/api/connect/refresh") => {
    setErr("");
    setNote("");
    setBusy("connect");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const url = typeof data["url"] === "string" ? data["url"] : null;
      if (!res.ok || !url) throw new Error(apiErrorLine(data, t("worldCoachMoney.poStartSetupError")));
      window.open(url, "_blank", "noopener,noreferrer");
      setNote(t("worldCoachMoney.poSetupOpenedNote"));
    } catch (e) {
      setErr(plainErrorText(e, t("worldCoachMoney.poStartSetupError")));
    } finally {
      setBusy(null);
    }
  };

  const doPayout = async () => {
    /* The world's two-step discipline for an irreversible money
       move: the first tap arms the exact amount, the second sends
       it. The rail re-checks everything server-side either way. */
    if (!confirmingPayout) {
      setConfirmingPayout(true);
      return;
    }
    setErr("");
    setNote("");
    setBusy("payout");
    try {
      const res = await fetch("/api/connect/payout", {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.poPayoutFailed")));
      const success = payoutSuccessNote(data);
      if (!success) throw new Error(t("worldCoachMoney.poPayoutFailed"));
      setNote(success);
      setConfirmingPayout(false);
      await load();
    } catch (e) {
      setErr(plainErrorText(e, t("worldCoachMoney.poPayoutFailed")));
      setConfirmingPayout(false);
    } finally {
      setBusy(null);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/55";
  const heading = isLight ? "text-[#2a1e07]" : "text-white";
  const goldBtn = `inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2.5 text-sm font-black text-black transition hover:scale-105 disabled:opacity-40 bdv-touch-target`;

  if (noProfile) {
    return (
      <NativeCard isLight={isLight} title={t("worldCoachMoney.poTitle")}>
        <p className={`text-sm ${muted}`}>{t("worldCoachMoney.poNoProfileBody")}</p>
      </NativeCard>
    );
  }
  if (notConfigured) {
    return (
      <NativeCard isLight={isLight} title={t("worldCoachMoney.poTitle")}>
        <p className={`text-sm ${muted}`}>{t("worldCoachMoney.poNotConfiguredBody")}</p>
      </NativeCard>
    );
  }
  if (!status && loadFailed) {
    return (
      <NativeCard isLight={isLight} title={t("worldCoachMoney.poTitle")}>
        <p className="flex items-start gap-2 text-xs font-bold text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {t("worldCoachMoney.poLoadFailedLine")}
        </p>
        <button
          type="button"
          onClick={() => { setLoadFailed(false); void load(); }}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
        >
          <RotateCcw className="h-4 w-4" /> {t("worldCoachMoney.tryAgain")}
        </button>
      </NativeCard>
    );
  }
  if (!status) {
    return (
      <NativeCard isLight={isLight} title={t("worldCoachMoney.poTitle")}>
        <p className={`inline-flex items-center gap-2 text-sm ${muted}`}>
          <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {t("worldCoachMoney.poLoading")}
        </p>
      </NativeCard>
    );
  }

  const state = payoutDeskState(status);
  const cashable = canCashOut(status);

  return (
    <NativeCard isLight={isLight} title={t("worldCoachMoney.poTitle")}>
      <div data-testid="world-payout-desk" className="space-y-3">
        <p className={`flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#d4af37]`}>
          <Wallet className="h-4 w-4" /> {t("worldCoachMoney.poBankHeading")}
          {status.testMode && (
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/20 text-white/50"}`}>
              {t("worldCoachMoney.poTestMode")}
            </span>
          )}
        </p>

        {state === "connect" && (
          <>
            <h3 className={`text-lg font-black ${heading}`}>{t("worldCoachMoney.poConnectHeading")}</h3>
            <p className={`text-sm leading-relaxed ${muted}`}>{t("worldCoachMoney.poConnectBody")}</p>
            <button type="button" data-testid="world-payout-connect" onClick={() => void goOnboard("/api/connect/onboard")} disabled={busy === "connect"} className={goldBtn}>
              {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}
              {t("worldCoachMoney.poConnectButton")}
            </button>
          </>
        )}

        {state === "finish-setup" && (
          <>
            <h3 className={`text-lg font-black ${heading}`}>{t("worldCoachMoney.poFinishHeading")}</h3>
            <p className={`text-sm leading-relaxed ${muted}`}>
              {t("worldCoachMoney.poFinishBody")}
              {status.pendingCents > 0 && <> {t("worldCoachMoney.poPendingMeanwhile")} <span className="font-bold">{payoutDollars(status.pendingCents)}</span>.</>}
            </p>
            <button type="button" data-testid="world-payout-finish" onClick={() => void goOnboard("/api/connect/refresh")} disabled={busy === "connect"} className={goldBtn}>
              {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("worldCoachMoney.poFinishButton")}
            </button>
          </>
        )}

        {state === "ready" && (
          <>
            <h3 className={`text-lg font-black ${heading}`}>
              {t("worldCoachMoney.poReadyPrefix")} <span className="text-[#d4af37]">{payoutDollars(status.pendingCents)}</span>
            </h3>
            <p className={`text-sm leading-relaxed ${muted}`}>
              <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-400" />
              {t("worldCoachMoney.poBankVerifiedMin", { amount: payoutDollars(status.minPayoutCents) })}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="world-payout-cashout"
                onClick={() => void doPayout()}
                disabled={!cashable || busy === "payout"}
                className={goldBtn}
              >
                {busy === "payout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {confirmingPayout ? t("worldCoachMoney.poSendConfirm", { amount: payoutDollars(status.pendingCents) }) : t("worldCoachMoney.poCashOut", { amount: payoutDollars(status.pendingCents) })}
              </button>
              {confirmingPayout && (
                <button type="button" onClick={() => setConfirmingPayout(false)} className={`text-xs font-bold bdv-touch-target ${muted}`}>
                  {t("worldCoachMoney.poNotYet")}
                </button>
              )}
              <button
                type="button"
                data-testid="world-payout-manage"
                onClick={() => void goOnboard("/api/connect/refresh")}
                disabled={busy === "connect"}
                className={`inline-flex items-center gap-1.5 text-xs font-bold bdv-touch-target ${muted} hover:underline`}
              >
                {busy === "connect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                {t("worldCoachMoney.poManageSetup")}
              </button>
            </div>
            {!cashable && (
              <p className={`text-[11px] ${muted}`}>
                {t("worldCoachMoney.poUnlocksAt", { amount: payoutDollars(status.minPayoutCents) })}
              </p>
            )}
          </>
        )}

        {err && (
          <>
            <p className="flex items-start gap-2 text-xs font-bold text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {err}
            </p>
            <button
              type="button"
              onClick={() => { setErr(""); void load(); }}
              className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
            >
              <RotateCcw className="h-4 w-4" /> {t("worldCoachMoney.tryAgain")}
            </button>
          </>
        )}
        {note && (
          <p className={`flex items-start gap-2 text-xs font-bold ${isLight ? "text-[#4a6b1f]" : "text-emerald-300"}`}>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {note}
          </p>
        )}
      </div>
    </NativeCard>
  );
}
