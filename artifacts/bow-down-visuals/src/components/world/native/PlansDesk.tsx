import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Crown, Loader2 } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import {
  PLAN_CHANGE_CLEARS_CANCEL_LINE,
  apiErrorLine,
  parseSitePlanMe,
  parseSitePlans,
  planChangeChargeLine,
  planChangeOutcome,
  planChangeStartLine,
  planCheckoutPayload,
  planHostedUrl,
  planIntentOutcome,
  planPriceLabel,
  plansNote,
  type PlanChangeOutcome,
  type PlanChangePreview,
  type PlanIntentOutcome,
  type SitePlan,
  type SitePlanMe,
} from "@/lib/world/money-desks-2";
import { EmbeddedPaymentForm, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import { checkoutFailureCopy, postJsonWithTransportRetry } from "@/lib/checkout-fetch";

/* ─── PlansDesk — your site plan (Free / Pro / Elite), purchasable
   from the Get Paid Room (Stack-100 #69). The creator-pricing page
   is the reference implementation: the catalog is READ from
   GET /api/creator-tiers/plans — names, prices, fee rates and
   boosts all ride the rail's own DTO (verified in code: Pro
   $12/mo, Elite $29/mo in platform-fees TIER_PLANS), never a local
   price table — and the caller's standing comes from
   GET /api/creator-tiers/me. JOIN2 MONEY MOMENT: the desk consumes
   the embedded checkout form (orphan embedded-checkout lane) for
   buying — with a publishable key present, Buy opens the on-page
   PaymentElement form in this desk via POST
   /api/embedded-checkout/subscription/intent and confirms through
   its /verify twin (the creator-pricing page's own embedded flow).
   An intent that FAILS stops in this desk with the pricing page's
   honest error — it never falls through to a hosted page
   (stack600 plansdesk-honesty; see checkout() below). A subscriber
   who picks a DIFFERENT tier gets the intent's mode:"change"
   answer: the desk shows the proration preview in an in-desk
   confirm panel (the pricing page's copy and pinned numbers) and
   applies the swap via POST /api/creator-tiers/change — same
   subscription, same card, all inside this sheet (stack600
   plansdesk-change; see applyChange() below).
   The hosted rail remains the fallback when no key is configured:
   POST /api/creator-tiers/checkout { tier, returnTo: "/world" },
   and managing rides POST /api/creator-tiers/portal; both answer a
   hosted Stripe page, which opens in a NEW TAB (the sanctioned
   exit — the pricing page leaves for the same hosted pages), and
   the desk re-reads /me on focus so a landed upgrade shows. The
   plans payload's own note line renders verbatim. A plan whose
   Stripe price isn't configured server-side (priceConfigured
   false) says so on its card instead of offering a checkout that
   can't start. Members only — the board above already pitches
   guests. */

/* The desk's own copy lives in the locale catalogs (worldPlansDesk.*)
   — stack800 lane 3: this desk previously rendered hard-coded English
   inside a 10-locale product. The plan names/taglines/features and the
   server note still ride the rail's DTO verbatim (by design, see the
   header note), and the shared money-desks-2 change lines — which
   state charge amounts — stay English pending human translation:
   money copy is never agent-drafted. */
function planStatusLabelKey(status: string): string {
  switch (status) {
    case "canceled":
    case "cancelled":
      return "worldPlansDesk.statusCanceled";
    case "past_due":
      return "worldPlansDesk.statusPastDue";
    case "trialing":
      return "worldPlansDesk.statusTrialing";
    case "incomplete":
    case "incomplete_expired":
      return "worldPlansDesk.statusIncomplete";
    case "unpaid":
      return "worldPlansDesk.statusUnpaid";
    default:
      return "worldPlansDesk.statusAttention";
  }
}

export function PlansDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  const [plans, setPlans] = useState<SitePlan[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [me, setMe] = useState<SitePlanMe | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [openedNote, setOpenedNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState<{ tier: string; clientSecret: string; subscriptionId: string; label: string } | null>(null);
  const [changePreview, setChangePreview] = useState<PlanChangePreview | null>(null);
  const [changing, setChanging] = useState(false);

  const load = useCallback(async () => {
    try {
      const [plansRes, meRes] = await Promise.all([
        fetch("/api/creator-tiers/plans"),
        fetch("/api/creator-tiers/me", { headers: await authHeaders() }),
      ]);
      if (!plansRes.ok) throw new Error("plans");
      const payload = (await plansRes.json()) as unknown;
      const parsed = parseSitePlans(payload);
      if (!parsed) throw new Error("plans");
      setPlans(parsed);
      setNote(plansNote(payload));
      if (meRes.ok) setMe(parseSitePlanMe(await meRes.json()));
      setLoadFailed(false);
    } catch { setLoadFailed(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Back from a hosted tab: the webhook may land a beat after
     Stripe lets go — re-read the standing on focus. */
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  /* Embedded confirm: the first payment succeeded in the form — the
     /verify twin settles the subscription server-side; the desk then
     re-reads /me so the new standing shows here. */
  const confirmEmbedded = async (paymentIntentId: string) => {
    if (!embedded) return;
    try {
      const res = await fetch("/api/embedded-checkout/subscription/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ paymentIntentId, subscriptionId: embedded.subscriptionId }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("worldPlansDesk.confirmPending"));
        return;
      }
      const tierName = embedded.tier;
      setEmbedded(null);
      setOpenedNote(t("worldPlansDesk.confirmSuccess", { tier: tierName === "elite" ? "Elite" : "Pro" }));
      void load();
    } catch {
      setError(t("worldPlansDesk.confirmPending"));
    }
  };

  const checkout = async (plan: SitePlan) => {
    if (busyTier) return;
    setBusyTier(plan.tier);
    setError(null);
    setOpenedNote(null);
    setChangePreview(null);
    try {
      /* Embedded first (never leave the site) — the intent answers
         a clientSecret + subscriptionId and the desk mounts the
         shared form. HONESTY (stack600 plansdesk-honesty, mirroring
         the creator-pricing page): ANY intent failure STOPS here
         with the page's own error copy — a server answer shows its
         message, or names its HTTP status with the
         nothing-charged line when it sent none (so the route's own
         409 tells an already-subscribed member to manage their
         plan — the Manage / cancel button on their own card —
         instead of silently opening a hosted upgrade page), and a
         transport failure is named by checkoutFailureCopy. The
         desk NEVER falls through to the hosted rail on a failed
         intent: leaving for a hosted page on an error breaks
         never-leave-the-site and hid the Gate #2 502s from buyers.
         The intent POST rides the page's transport-resilient
         helper — the intent is idempotency-keyed server-side, so
         a transport retry replays the same subscription, never a
         second one. The hosted rail below now serves ONLY the
         no-publishable-key configuration, where embedded checkout
         cannot run at all. */
      if (hasStripePublishableKey()) {
        const headers = await authHeaders();
        const token = headers.Authorization?.replace(/^Bearer\s+/i, "") ?? null;
        let outcome: PlanIntentOutcome;
        try {
          const result = await postJsonWithTransportRetry(
            "/api/embedded-checkout/subscription/intent",
            { token, body: { tier: plan.tier } },
          );
          outcome = planIntentOutcome(result, plan.name);
        } catch (err) {
          /* Every attempt failed at transport level — the helper
             only throws for those; a server JSON answer is returned
             above, never thrown. */
          setError(checkoutFailureCopy(err));
          return;
        }
        if (outcome.kind === "embedded") {
          setEmbedded({
            tier: plan.tier,
            clientSecret: outcome.clientSecret,
            subscriptionId: outcome.subscriptionId,
            label: outcome.label,
          });
          return;
        }
        if (outcome.kind === "changed") {
          /* In-place tier change answered by the intent itself —
             same note the hosted path used for { changed: true }. */
          setOpenedNote(t("worldPlansDesk.planChanged", { name: plan.name }));
          void load();
          return;
        }
        if (outcome.kind === "change") {
          /* A subscriber switching tiers (stack600 tier-change):
             the intent charged NOTHING — it answered the proration
             preview. The confirm panel below shows those pinned
             numbers and Confirm applies the swap in place via
             applyChange; Not now leaves everything untouched. */
          setEmbedded(null);
          setChangePreview(outcome.preview);
          return;
        }
        setError(outcome.message);
        return;
      }
      const res = await fetch("/api/creator-tiers/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(planCheckoutPayload(plan.tier)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldPlansDesk.checkoutStartFailed")));
      if (data.changed === true) {
        /* In-place tier change (payfix upgrade-path): same
           subscription, prorated — no payment page exists. */
        setOpenedNote(t("worldPlansDesk.planChanged", { name: plan.name }));
        void load();
        return;
      }
      const url = planHostedUrl(data);
      if (!url) throw new Error(t("worldPlansDesk.checkoutNoPage"));
      window.open(url, "_blank", "noopener,noreferrer");
      setOpenedNote(t("worldPlansDesk.checkoutOpenedTab", { name: plan.name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("worldPlansDesk.networkHiccup"));
    } finally { setBusyTier(null); }
  };

  /* Confirm the tier change (stack600 plansdesk-change): POST the
     preview's tier to the ONE change endpoint the pricing page and
     Settings → Billing use. The endpoint re-prices the swap at the
     proration instant it pinned for the preview the walker just
     confirmed — the numbers on the panel are the numbers charged —
     and the swap is idempotency-keyed on the pre-change state, so
     a double-tap replays as alreadyApplied instead of charging
     twice. The POST rides the same transport-resilient helper as
     the intent (safe for the same reason), and every failure stops
     HERE with the honest line — the panel stays up so the walker
     can read it, retry, or back out with Not now. Nothing about
     this path leaves the sheet: no new tab, no hosted fallback. */
  const applyChange = async () => {
    if (!changePreview || changing) return;
    setChanging(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const token = headers.Authorization?.replace(/^Bearer\s+/i, "") ?? null;
      let outcome: PlanChangeOutcome;
      try {
        const result = await postJsonWithTransportRetry(
          "/api/creator-tiers/change",
          { token, body: { tier: changePreview.toTier } },
        );
        outcome = planChangeOutcome(result);
      } catch (err) {
        /* Every attempt failed at transport level — named by the
           shared failure copy, nothing-charged wording included. */
        setError(checkoutFailureCopy(err));
        return;
      }
      if (outcome.kind === "error") {
        setError(outcome.message);
        return;
      }
      const name = changePreview.toPlanName;
      setChangePreview(null);
      setOpenedNote(t("worldPlansDesk.planChanged", { name }));
      void load();
    } finally { setChanging(false); }
  };

  const openPortal = async () => {
    if (portalBusy) return;
    setPortalBusy(true);
    setError(null);
    setOpenedNote(null);
    try {
      const res = await fetch("/api/creator-tiers/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ returnTo: "/world" }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldPlansDesk.portalOpenFailed")));
      const url = planHostedUrl(data);
      if (!url) throw new Error(t("worldPlansDesk.portalNoPage"));
      window.open(url, "_blank", "noopener,noreferrer");
      setOpenedNote(t("worldPlansDesk.portalOpened"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("worldPlansDesk.networkHiccup"));
    } finally { setPortalBusy(false); }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <NativeCard isLight={isLight} title={t("worldPlansDesk.title")}>
      <div data-testid="world-plans-desk" className="space-y-3">
        {loadFailed ? (
          <p className={`text-xs ${muted}`}>
            {t("worldPlansDesk.loadFailed")}{" "}
            <button type="button" data-testid="world-plans-retry" onClick={() => void load()} className="font-bold text-[#d4af37]">{t("worldPlansDesk.tryAgain")}</button>
          </p>
        ) : plans === null ? (
          <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> {t("worldPlansDesk.loading")}
          </p>
        ) : (
          <>
            {me && (
              <p className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                {t("worldPlansDesk.standingPrefix")}<strong className="capitalize">{me.tier}</strong>
                {me.status !== "active" ? t("worldPlansDesk.standingStatus", { status: t(planStatusLabelKey(me.status)) }) : ""}
                {t("worldPlansDesk.standingSuffix", { feePct: me.feePct, boosts: me.aiBoostsPerMonth })}
                {me.currentPeriodEnd ? t("worldPlansDesk.standingPeriod", { date: new Date(me.currentPeriodEnd).toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" }) }) : ""}.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              {plans.map((plan) => {
                const isMine = me?.tier === plan.tier;
                const paid = plan.priceUsdPerMonth !== null;
                /* A paid subscriber looking at the OTHER paid tier is
                   switching, not buying — the card says so, like the
                   pricing page's subscriber buttons. */
                const isSwitch = !!me && paid && me.tier !== "free" && me.tier !== plan.tier;
                return (
                  <div key={plan.tier} data-testid={`world-plan-${plan.tier}`}
                    className={`flex flex-col rounded-2xl border px-3 py-3 ${isMine ? "border-[#d4af37] bg-[#d4af37]/[0.07]" : isLight ? "border-[#7A5A12]/25 bg-white/50" : "border-white/10 bg-white/5"}`}>
                    <p className={`flex items-center gap-1.5 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                      <Crown className="h-4 w-4 text-[#d4af37]" /> {plan.name}
                      {isMine && <span className="ml-auto rounded-full bg-[#d4af37] px-2 py-0.5 text-[10px] font-black text-black">{t("worldPlansDesk.yourPlan")}</span>}
                    </p>
                    <p className="text-xl font-black text-[#d4af37]">{planPriceLabel(plan)}</p>
                    {plan.tagline && <p className={`text-[11px] ${muted}`}>{plan.tagline}</p>}
                    <p className={`mt-1 text-[11px] ${muted}`}>{t("worldPlansDesk.feeLine", { feePct: plan.feePct, boosts: plan.aiBoostsPerMonth })}</p>
                    <ul className={`mt-2 flex-1 space-y-1 text-[11px] ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>
                      {plan.features.slice(0, 5).map((f) => (
                        <li key={f} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-[#d4af37]" /> {f}</li>
                      ))}
                    </ul>
                    {isMine ? (
                      paid ? (
                        <button type="button" data-testid="world-plan-manage" onClick={() => void openPortal()} disabled={portalBusy}
                          className={`mt-3 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 bdv-touch-target ${isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"}`}>
                          {portalBusy ? t("worldPlansDesk.opening") : t("worldPlansDesk.manage")}
                        </button>
                      ) : (
                        <p className={`mt-3 text-center text-[11px] font-bold ${muted}`}>{t("worldPlansDesk.startingPlan")}</p>
                      )
                    ) : !paid ? (
                      <p className={`mt-3 text-center text-[11px] ${muted}`}>{t("worldPlansDesk.downgradeNote")}</p>
                    ) : !plan.purchasable ? (
                      <p className={`mt-3 text-center text-[11px] font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                        {t("worldPlansDesk.notPurchasable")}
                      </p>
                    ) : (
                      <button type="button" data-testid={`world-plan-buy-${plan.tier}`} onClick={() => void checkout(plan)} disabled={busyTier !== null}
                        className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
                        {busyTier === plan.tier ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
                        {busyTier === plan.tier ? t("worldPlansDesk.starting") : isSwitch ? t("worldPlansDesk.switchTo", { name: plan.name, price: planPriceLabel(plan) }) : t("worldPlansDesk.goPlan", { name: plan.name, price: planPriceLabel(plan) })}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {embedded && (
              <div className="mx-auto w-full max-w-md" data-testid="world-plans-embedded">
                <p className={`mb-2 text-center text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {t("worldPlansDesk.finishUpgrade", { tier: embedded.tier === "elite" ? "Elite" : "Pro" })}
                </p>
                <EmbeddedPaymentForm
                  clientSecret={embedded.clientSecret}
                  submitLabel={embedded.label}
                  onConfirmed={confirmEmbedded}
                  onError={(msg) => setError(msg)}
                />
                <button
                  type="button"
                  onClick={() => setEmbedded(null)}
                  className={`mt-2 w-full text-center text-xs bdv-touch-target ${isLight ? "text-[#6B5B36] hover:text-[#2a1e07]" : "text-white/40 hover:text-white/70"}`}
                >
                  {t("worldPlansDesk.cancelNoCharge")}
                </button>
              </div>
            )}
            {changePreview && (
              <div data-testid="world-plans-change-confirm"
                className={`mx-auto w-full max-w-md rounded-2xl border px-4 py-3 ${isLight ? "border-[#7A5A12]/40 bg-white/50" : "border-[#d4af37]/40 bg-[#d4af37]/[0.07]"}`}>
                <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {t("worldPlansDesk.switchTitle", { name: changePreview.toPlanName })}
                </p>
                <p className={`mt-1 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>
                  {planChangeChargeLine(changePreview)}
                </p>
                <p className={`mt-1 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>
                  {planChangeStartLine(changePreview)}
                </p>
                {changePreview.clearsPendingCancel && (
                  <p className={`mt-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                    {PLAN_CHANGE_CLEARS_CANCEL_LINE}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button type="button" data-testid="world-plans-change-apply" onClick={() => void applyChange()} disabled={changing}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target">
                    {changing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
                    {changing ? t("worldPlansDesk.switching") : t("worldPlansDesk.switchYes", { name: changePreview.toPlanName })}
                  </button>
                  <button type="button" data-testid="world-plans-change-cancel" onClick={() => setChangePreview(null)} disabled={changing}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 bdv-touch-target ${isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"}`}>
                    {t("worldPlansDesk.notNow")}
                  </button>
                </div>
              </div>
            )}
            {note && <p className={`text-[11px] ${muted}`}>{note}</p>}
            {openedNote && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{openedNote}</p>}
            {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
          </>
        )}
      </div>
    </NativeCard>
  );
}
