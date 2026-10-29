import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { CreditCard, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  describeBilling,
  formatBillingDate,
  type BillingStateView,
} from "@/lib/billing-display";
import {
  loadBilling,
  BillingLoadError,
  type BillingLoadFailureKind,
} from "@/lib/billing-load";

/* Terminal load copy per failure kind (stack800 lane 4): the old card
   collapsed every cause into one "Couldn't load your billing" and
   Retry re-ran the identical unbounded fetch, so a failure that
   persisted looked — and was — identical forever. Each kind names
   its own remedy: a dead session wants a sign-in, a dropped gate
   pass wants the gate, an unreachable/server failure wants a wait. */
const LOAD_ERROR_KEYS: Record<BillingLoadFailureKind, string> = {
  unauthorized: "settings.billing.loadErrorSession",
  gated: "settings.billing.loadErrorGated",
  server: "settings.billing.loadErrorServer",
  unreachable: "settings.billing.loadErrorUnreachable",
};

/* Mirror of the server's TierChangePreviewView (lib/tier-change.ts) —
   the honest proration numbers behind the change-plan confirm panel. */
interface TierChangePreview {
  fromTier: string;
  fromPlanName: string;
  toTier: string;
  toPlanName: string;
  toPriceUsdPerMonth: number | null;
  amountDueTodayCents: number;
  creditCents: number;
  currency: string;
  effective: string;
  renewalDate: string | null;
  clearsPendingCancel: boolean;
}

/* ── Settings → Billing ───────────────────────────────────────────────────
   The billing surface the FAQ always promised: current plan, price,
   renewal date, and a WORKING cancel that lives on this site — POST
   /api/creator-tiers/cancel sets Stripe cancel_at_period_end, so the
   tier is kept until the end of the billing period and only then
   glides back to Free. Resume undoes a pending cancel the same way.
   State comes from GET /api/creator-tiers/billing, which reads the
   same creator_subscriptions row the Stripe webhook sync maintains —
   one source of truth, no drift. The Stripe portal stays a secondary
   door for payment-method updates only. */

export function BillingSettings() {
  const isLight = useIsLightTheme();
  const { t, i18n } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [billing, setBilling] = useState<BillingStateView | null>(null);
  const [loadFailure, setLoadFailure] = useState<BillingLoadFailureKind | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [changePreview, setChangePreview] = useState<TierChangePreview | null>(null);
  const [busy, setBusy] = useState<"cancel" | "resume" | "portal" | "previewChange" | "change" | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadFailure(null);
      try {
        /* Bounded + classified (lib/billing-load): the old bare fetch
         * had no timeout on the request AND none on the token call in
         * front of it, and Retry re-ran the identical sequence — in
         * Gate #4's final session the failure simply repeated. The
         * loader bounds the whole attempt, retries what can heal,
         * and reports which world failed. */
        const view = await loadBilling({
          getToken: getAccessToken,
          isCancelled: () => cancelled,
        });
        if (!cancelled) setBilling(view);
      } catch (err) {
        if (cancelled) return;
        setLoadFailure(err instanceof BillingLoadError ? err.failure : "unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken, retryNonce]);

  async function post(path: string): Promise<BillingStateView | null> {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({}),
    });
    const d = (await res.json().catch(() => ({}))) as { billing?: BillingStateView; url?: string };
    if (!res.ok) {
      // The server ships the current billing state on honest 409s —
      // adopt it so the card never shows a stale plan.
      if (d.billing) setBilling(d.billing);
      throw new Error("request failed");
    }
    return (d.billing ?? null) as BillingStateView | null;
  }

  async function cancel() {
    if (busy) return;
    setBusy("cancel");
    try {
      const next = await post("/api/creator-tiers/cancel");
      if (next) setBilling(next);
      setConfirmingCancel(false);
      toast({
        title: t("settings.billing.cancelDoneTitle"),
        description: t("settings.billing.cancelDoneBody", {
          plan: billing?.planName ?? "",
          date: formatBillingDate(next?.endsAt ?? billing?.endsAt ?? null, i18n.language) ?? "",
        }),
      });
    } catch {
      toast({ title: t("settings.billing.cancelFailed"), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function resume() {
    if (busy) return;
    setBusy("resume");
    try {
      const next = await post("/api/creator-tiers/resume");
      if (next) setBilling(next);
      toast({
        title: t("settings.billing.resumeDoneTitle"),
        description: t("settings.billing.resumeDoneBody", { plan: next?.planName ?? billing?.planName ?? "" }),
      });
    } catch {
      toast({ title: t("settings.billing.resumeFailed"), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  function formatMoney(cents: number, currency: string): string {
    try {
      return new Intl.NumberFormat(i18n.language, {
        style: "currency",
        currency: (currency || "usd").toUpperCase(),
      }).format(cents / 100);
    } catch {
      return `$${(cents / 100).toFixed(2)}`;
    }
  }

  /* Change plan, step 1: price the swap. POST /change/preview runs
     Stripe's own proration math and charges NOTHING — the confirm
     panel below shows exactly what will happen before any money
     moves (Gate Pass 1: subscribers had NO tier-change path at all). */
  async function previewChange() {
    if (busy || !billing) return;
    const target = describeBilling(billing).changeTargetTier;
    if (!target) return;
    setBusy("previewChange");
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/creator-tiers/change/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ tier: target }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        preview?: TierChangePreview;
        billing?: BillingStateView;
      };
      if (d.billing) setBilling(d.billing);
      if (!res.ok || !d.preview) throw new Error("preview failed");
      setChangePreview(d.preview);
    } catch {
      toast({ title: t("settings.billing.changePreviewFailed"), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  /* Change plan, step 2: apply it. The server reprices the SAME
     subscription in place (never a second subscription) with the
     confirmed proration, and answers with the fresh billing state. */
  async function applyChange() {
    if (busy || !changePreview) return;
    setBusy("change");
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/creator-tiers/change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ tier: changePreview.toTier }),
      });
      const d = (await res.json().catch(() => ({}))) as { billing?: BillingStateView };
      if (d.billing) setBilling(d.billing);
      if (!res.ok) throw new Error("change failed");
      const planName = changePreview.toPlanName;
      setChangePreview(null);
      toast({
        title: t("settings.billing.changeDoneTitle"),
        description: t("settings.billing.changeDoneBody", { plan: planName }),
      });
    } catch {
      toast({ title: t("settings.billing.changeFailed"), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function managePayment() {
    if (busy) return;
    setBusy("portal");
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/creator-tiers/portal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ returnTo: "/settings" }),
      });
      const d = (await res.json().catch(() => ({}))) as { url?: string };
      if (!res.ok || !d.url) throw new Error("portal failed");
      window.location.href = d.url;
    } catch {
      toast({ title: t("settings.billing.manageFailed"), variant: "destructive" });
      setBusy(null);
    }
  }

  const display = billing ? describeBilling(billing) : null;
  const dateText = display ? formatBillingDate(display.dateIso, i18n.language) : null;

  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const subCls = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <section className={`rounded-2xl border p-5 md:p-6 ${cardCls}`} data-testid="billing-settings">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
          <CreditCard className="h-4 w-4 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-bold">{t("settings.billing.title")}</h2>
          <p className={`text-xs ${subCls}`}>{t("settings.billing.subtitle")}</p>
        </div>
      </div>

      {!billing && !loadFailure && (
        <p className={`mt-5 flex items-center gap-2 text-sm ${subCls}`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("settings.billing.loading")}
        </p>
      )}

      {loadFailure && (
        <div className="mt-5">
          <p className="text-sm text-red-400">{t(LOAD_ERROR_KEYS[loadFailure])}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-3 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold transition hover:bg-white/10"
          >
            {t("settings.billing.retry")}
          </button>
        </div>
      )}

      {billing && display && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-black tracking-tight" data-testid="billing-plan">
              {billing.planName}
            </span>
            {display.priceLine && <span className={`text-sm font-semibold ${subCls}`}>{display.priceLine}</span>}
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-black uppercase tracking-widest ${
                display.status === "canceling" || display.status === "past_due"
                  ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                  : "border-primary/40 bg-primary/10 text-primary"
              }`}
              data-testid="billing-status"
            >
              {t(`settings.billing.status.${display.statusKey}`)}
            </span>
          </div>

          {display.status === "free" && <p className={`text-sm ${subCls}`}>{t("settings.billing.freeBody")}</p>}
          {display.status === "past_due" && <p className="text-sm text-amber-300">{t("settings.billing.pastDueBody")}</p>}
          {display.status === "incomplete" && <p className={`text-sm ${subCls}`}>{t("settings.billing.incompleteBody")}</p>}

          {display.dateKind === "renews" && dateText && (
            <p className={`text-sm ${subCls}`} data-testid="billing-date">
              {t("settings.billing.renewsOn", { date: dateText })}
            </p>
          )}
          {display.dateKind === "ends" && dateText && (
            <p className="text-sm font-semibold text-amber-300" data-testid="billing-date">
              {t("settings.billing.endsOn", { date: dateText, plan: billing.planName })}
            </p>
          )}
          {display.dateKind === "ended" && dateText && (
            <p className={`text-sm ${subCls}`} data-testid="billing-date">
              {t("settings.billing.endedOn", { date: dateText })}
            </p>
          )}

          {changePreview && display.showChangePlan && (
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-4" data-testid="billing-change-confirm">
              <p className="text-sm font-bold text-primary">
                {t("settings.billing.changeConfirmTitle", { plan: changePreview.toPlanName })}
              </p>
              {changePreview.amountDueTodayCents > 0 && (
                <p className="mt-1 text-xs text-white/70">
                  {t("settings.billing.changeChargeToday", {
                    amount: formatMoney(changePreview.amountDueTodayCents, changePreview.currency),
                    fromPlan: changePreview.fromPlanName,
                    plan: changePreview.toPlanName,
                  })}
                </p>
              )}
              {changePreview.amountDueTodayCents === 0 && changePreview.creditCents > 0 && (
                <p className="mt-1 text-xs text-white/70">
                  {t("settings.billing.changeCredit", {
                    amount: formatMoney(changePreview.creditCents, changePreview.currency),
                    fromPlan: changePreview.fromPlanName,
                  })}
                </p>
              )}
              {changePreview.amountDueTodayCents === 0 && changePreview.creditCents === 0 && (
                <p className="mt-1 text-xs text-white/70">{t("settings.billing.changeNoCharge")}</p>
              )}
              <p className="mt-1 text-xs text-white/70">
                {changePreview.renewalDate
                  ? t("settings.billing.changeImmediate", {
                      plan: changePreview.toPlanName,
                      date: formatBillingDate(changePreview.renewalDate, i18n.language) ?? "",
                    })
                  : t("settings.billing.changeImmediateNoDate", { plan: changePreview.toPlanName })}
              </p>
              {changePreview.clearsPendingCancel && (
                <p className="mt-1 text-xs font-semibold text-amber-300">
                  {t("settings.billing.changeClearsCancel")}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { void applyChange(); }}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                  data-testid="billing-change-confirm-button"
                >
                  {busy === "change" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("settings.billing.changeConfirmButton")}
                </button>
                <button
                  type="button"
                  onClick={() => setChangePreview(null)}
                  disabled={busy !== null}
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-50"
                >
                  {t("settings.billing.changeBack")}
                </button>
              </div>
            </div>
          )}

          {confirmingCancel && display.showCancel && (
            <div className="rounded-xl border border-red-500/40 bg-red-950/20 p-4">
              <p className="text-sm font-bold text-red-300">
                {t("settings.billing.cancelConfirmTitle", { plan: billing.planName })}
              </p>
              <p className="mt-1 text-xs text-white/60">
                {t("settings.billing.cancelConfirmBody", {
                  plan: billing.planName,
                  date: formatBillingDate(billing.currentPeriodEnd, i18n.language) ?? "",
                })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { void cancel(); }}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-500 disabled:opacity-50"
                >
                  {busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("settings.billing.cancelConfirmButton")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={busy !== null}
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-50"
                >
                  {t("settings.billing.keepPlan")}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {display.showSeePlans && (
              <Link
                href="/creator-pricing"
                className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20"
              >
                {t("settings.billing.seePlans")}
              </Link>
            )}
            {display.showChangePlan && !changePreview && (
              <button
                type="button"
                onClick={() => { void previewChange(); }}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                data-testid="billing-change-plan"
              >
                {busy === "previewChange" && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("settings.billing.changeButton", {
                  plan: display.changeTargetTier === "elite" ? "Elite" : "Pro",
                })}
              </button>
            )}
            {display.showCancel && !confirmingCancel && (
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                disabled={busy !== null}
                className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                data-testid="billing-cancel"
              >
                {t("settings.billing.cancelButton")}
              </button>
            )}
            {display.showResume && (
              <button
                type="button"
                onClick={() => { void resume(); }}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                data-testid="billing-resume"
              >
                {busy === "resume" && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("settings.billing.resumeButton")}
              </button>
            )}
            {display.showManagePayment && (
              <button
                type="button"
                onClick={() => { void managePayment(); }}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-50"
              >
                {busy === "portal" && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("settings.billing.managePayment")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
