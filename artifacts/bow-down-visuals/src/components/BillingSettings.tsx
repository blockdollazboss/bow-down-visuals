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
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [busy, setBusy] = useState<"cancel" | "resume" | "portal" | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/creator-tiers/billing", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        const d = (await res.json()) as { billing?: BillingStateView };
        if (cancelled) return;
        if (!d.billing) throw new Error("load failed");
        setBilling(d.billing);
      } catch {
        if (!cancelled) setLoadError(true);
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

      {!billing && !loadError && (
        <p className={`mt-5 flex items-center gap-2 text-sm ${subCls}`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("settings.billing.loading")}
        </p>
      )}

      {loadError && (
        <div className="mt-5">
          <p className="text-sm text-red-400">{t("settings.billing.loadError")}</p>
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
