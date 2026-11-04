import { useCallback, useEffect, useState } from "react";
import { Check, Crown, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/api-error";
import { useCreatorTier } from "@/hooks/use-creator-tier";
import { paidPlanCta, pricingCardCta } from "@/lib/pricing-card-state";
import {
  EmbeddedPaymentForm,
  hasStripePublishableKey,
} from "@/components/checkout/EmbeddedCheckout";
import {
  checkoutFailureCopy,
  postJsonWithTransportRetry,
} from "@/lib/checkout-fetch";
import {
  PLAN_CHANGE_CLEARS_CANCEL_LINE,
  planChangeChargeLine,
  planChangeOutcome,
  planChangeStartLine,
  planIntentOutcome,
  plansNote,
  type PlanChangePreview,
} from "@/lib/world/money-desks-2";
import {
  COACH_LADDER_TIER_STALL_MS,
  buildLadderPlans,
  ladderPriceLabel,
  parsePlanConfigOverlay,
  type CreatorTierId,
  type LadderPlanView,
  type PlanConfigOverlay,
} from "@/lib/world/coach-plan-ladder";
import { NativeCard } from "./NativeCard";
import { NativeErrorState, NativeLoadingState } from "./NativeStates";
import { goldBtn, useCoachAuthHeaders } from "./CoachPanelBits";

/* ─── CoachPlanLadderSection — the plan ladder + upgrade door,
   finished in-world in the Coach desk (Stack-100 Wave 5 #31,
   audit A14). The Coach panels already carry the money tracker
   and the plan numbers; the ladder itself — what the tiers are,
   what each includes, where the member stands — and the door to
   change it lived only on /creator-pricing and in Settings.

   The ladder is CREATOR_PLANS from lib/pricing-plans (the ONE
   pricing module both pricing pages render), overlaid with live
   configuration from GET /api/creator-tiers/plans exactly like
   the creator-pricing page: the fetch overlays config only, and
   a FAILED load is its own fact (paidPlanCta's retry state) —
   never a fake "price coming soon". The member's standing comes
   from useCreatorTier, the hook every tier display reads; while
   it is still out the desk says so, and if it never lands the
   desk shows the honest error + Retry — a plan is NEVER
   defaulted to Free.

   The upgrade door rides the creator-pricing page's embedded
   rails and NEVER LEAVES THE SITE: with a publishable key the
   subscription intent opens the shared PaymentElement form in
   this desk and confirms through its /verify twin; a subscriber
   switching tiers gets the intent's proration preview in an
   in-desk confirm panel and applies it via
   POST /api/creator-tiers/change — the PlansDesk's proven
   in-world flow, verdicts shared from money-desks-2. ANY intent
   failure stops here with the honest line. Where embedded
   checkout cannot run at all (no publishable key configured),
   the door does NOT fall back to a hosted page: it stops in the
   desk and says so (see the doorNote state). There is likewise
   no Manage/portal door here — the billing portal is a hosted
   page, and this desk builds no off-site door; standing (tier,
   status, period end) is shown from the rail instead. */

export function CoachPlanLadderSection({ isLight }: { isLight: boolean }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  return (
    <NativeCard isLight={isLight} title="Your creator plan — the full ladder">
      <div data-testid="world-coach-plan-ladder" className="space-y-3">
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          The same ladder as Creator Plans, read from the one pricing source: every tier
          sells at the same flat 5% platform fee, and paid tiers earn their keep with
          features — your own domain, unlimited products, pro analytics, more AI
          promotion boosts. Upgrading happens right here in the palace: the card form
          opens in this desk, never on a hosted page.
        </p>
        {successNote ? (
          <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
            {successNote}
          </p>
        ) : null}
        <PlanLadderBody
          key={reloadKey}
          isLight={isLight}
          onPlanChanged={(message) => {
            setSuccessNote(message);
            setReloadKey((k) => k + 1);
          }}
          onRetryTier={() => setReloadKey((k) => k + 1)}
        />
      </div>
    </NativeCard>
  );
}

function PlanLadderBody({
  isLight,
  onPlanChanged,
  onRetryTier,
}: {
  isLight: boolean;
  onPlanChanged: (message: string) => void;
  onRetryTier: () => void;
}) {
  const me = useCreatorTier();
  const authHeaders = useCoachAuthHeaders();
  const [overlay, setOverlay] = useState<Partial<Record<CreatorTierId, PlanConfigOverlay>>>({});
  const [note, setNote] = useState<string | null>(null);
  const [plansLoadFailed, setPlansLoadFailed] = useState(false);
  const [tierStalled, setTierStalled] = useState(false);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [doorNote, setDoorNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState<{
    tier: string;
    clientSecret: string;
    subscriptionId: string;
    label: string;
  } | null>(null);
  const [changePreview, setChangePreview] = useState<PlanChangePreview | null>(null);
  const [changing, setChanging] = useState(false);

  /* The live-config overlay — the creator-pricing page's load:
     non-ok or transport failure is the load-failed FACT; an ok
     payload overlays config tier by tier. */
  const loadPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/creator-tiers/plans");
      if (!res.ok) {
        setPlansLoadFailed(true);
        return;
      }
      const data: unknown = await res.json();
      setOverlay(parsePlanConfigOverlay(data));
      setNote(plansNote(data));
      setPlansLoadFailed(false);
    } catch {
      setPlansLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  /* useCreatorTier leaves its state null while the read is out —
     and forever when every attempt failed. Past the grace window
     that is called what it is: a failed read with a Retry, never
     a standing dressed up as the Free plan. If the read lands
     late, the ladder simply takes over. */
  useEffect(() => {
    if (me) {
      setTierStalled(false);
      return;
    }
    const timer = setTimeout(() => setTierStalled(true), COACH_LADDER_TIER_STALL_MS);
    return () => clearTimeout(timer);
  }, [me]);

  if (!me) {
    if (tierStalled) {
      return (
        <NativeErrorState
          isLight={isLight}
          title="Your plan wouldn't load"
          message="We couldn't read your current plan, so the ladder can't honestly mark where you stand. Nothing about your plan has changed."
          onRetry={onRetryTier}
        />
      );
    }
    return <NativeLoadingState isLight={isLight} message="Reading your plan…" />;
  }

  const plans = buildLadderPlans(overlay);
  const myView = plans.find((p) => p.tier === me.tier);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  const checkout = async (plan: LadderPlanView) => {
    if (busyTier) return;
    /* The page's CTA derivation guards the door: a failed plans
       load retries the LOAD — it never opens a checkout against
       unknown configuration. */
    const cta = paidPlanCta(plan.priceConfigured, plansLoadFailed);
    if (cta === "retry-load") {
      void loadPlans();
      return;
    }
    if (cta !== "buy") return;
    setBusyTier(plan.tier);
    setError(null);
    setDoorNote(null);
    setChangePreview(null);
    try {
      /* Embedded first (never leave the site). Where no
         publishable key is configured the embedded form cannot
         run at all — and this desk builds NO hosted fallback:
         the door stops here and says so, plan untouched. */
      if (!hasStripePublishableKey()) {
        setDoorNote(
          "Plan checkout isn't switched on inside the World right now — your plan is unchanged and nothing was charged.",
        );
        return;
      }
      const headers = await authHeaders();
      const token = headers.Authorization?.replace(/^Bearer\s+/i, "") ?? null;
      let outcome;
      try {
        const result = await postJsonWithTransportRetry(
          "/api/embedded-checkout/subscription/intent",
          { token, body: { tier: plan.tier } },
        );
        outcome = planIntentOutcome(result, plan.name);
      } catch (err) {
        /* Transport-level failure on every attempt — named by the
           shared failure copy, nothing-charged wording included. */
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
        onPlanChanged(`Your plan is now ${plan.name} — switched in place on the same subscription.`);
        return;
      }
      if (outcome.kind === "change") {
        /* A subscriber switching tiers: the intent charged
           NOTHING — it answered the proration preview. The
           confirm panel below shows those pinned numbers;
           Confirm applies the swap in place via applyChange. */
        setEmbedded(null);
        setChangePreview(outcome.preview);
        return;
      }
      /* Every other verdict is a STOP with the honest line — a
         server message when it sent one, else the shared failure
         copy. Never a fall-through to another rail. */
      setError(outcome.message);
    } finally {
      setBusyTier(null);
    }
  };

  /* The embedded form confirmed a payment: the /verify twin
     settles the subscription server-side, then the ladder
     re-reads the standing (the parent remounts this body) so the
     new plan shows where the member stands. */
  const confirmEmbedded = async (paymentIntentId: string) => {
    if (!embedded) return;
    const fallback =
      "Your payment went through — we're still applying your plan. Give it a moment, then check your standing here again.";
    try {
      const res = await fetch("/api/embedded-checkout/subscription/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          paymentIntentId,
          subscriptionId: embedded.subscriptionId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.success !== true) {
        setError(apiErrorMessage(data, fallback));
        return;
      }
      const name = embedded.tier === "elite" ? "Elite" : "Pro";
      setEmbedded(null);
      onPlanChanged(`You're ${name} now. Your plan is active — paid right here, no detour.`);
    } catch {
      setError(fallback);
    }
  };

  /* Confirm the tier change: POST the preview's tier to the ONE
     change endpoint the pricing page and Settings → Billing use.
     The endpoint re-prices the swap at the proration instant the
     preview pinned, and the swap is idempotency-keyed on the
     pre-change state — a double-tap replays as alreadyApplied
     instead of charging twice. Every failure stops HERE; the
     panel stays up so the member can retry or back out. */
  const applyChange = async () => {
    if (!changePreview || changing) return;
    setChanging(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const token = headers.Authorization?.replace(/^Bearer\s+/i, "") ?? null;
      let outcome;
      try {
        const result = await postJsonWithTransportRetry(
          "/api/creator-tiers/change",
          { token, body: { tier: changePreview.toTier } },
        );
        outcome = planChangeOutcome(result);
      } catch (err) {
        setError(checkoutFailureCopy(err));
        return;
      }
      if (outcome.kind === "error") {
        setError(outcome.message);
        return;
      }
      const name = changePreview.toPlanName;
      setChangePreview(null);
      onPlanChanged(`Your plan is now ${name} — switched in place on the same subscription.`);
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
        You&rsquo;re on <strong className="capitalize">{myView?.name ?? me.tier}</strong>
        {me.status !== "active" ? ` (${me.status.replace(/_/g, " ")})` : ""} — flat {me.feePct}{" "}
        platform fee
        {myView ? `, ${myView.aiBoostsPerMonth} AI promotion boosts a month` : ""}
        {me.currentPeriodEnd
          ? ` · current period runs to ${new Date(me.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
          : ""}
        .
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {plans.map((plan) => {
          const isMine = me.tier === plan.tier;
          const paid = plan.tier !== "free";
          const cta = paid
            ? paidPlanCta(plan.priceConfigured, plansLoadFailed)
            : pricingCardCta("free", me.tier);
          const isSwitch = paid && me.tier !== "free" && !isMine;
          return (
            <div
              key={plan.tier}
              data-testid={`world-coach-plan-${plan.tier}`}
              className={`flex flex-col rounded-2xl border px-3 py-3 ${
                isMine
                  ? "border-[#d4af37] bg-[#d4af37]/[0.07]"
                  : plan.tier === "pro"
                    ? isLight
                      ? "border-[#C9A84C]/70 bg-white/60"
                      : "border-amber-400/50 bg-white/5"
                    : isLight
                      ? "border-[#7A5A12]/25 bg-white/50"
                      : "border-white/10 bg-white/5"
              }`}
            >
              <p className={`flex items-center gap-1.5 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                <Crown className="h-4 w-4 text-[#d4af37]" /> {plan.name}
                {isMine && (
                  <span className="ml-auto rounded-full bg-[#d4af37] px-2 py-0.5 text-[10px] font-black text-black">
                    Your plan
                  </span>
                )}
              </p>
              {plan.tier === "pro" && !isMine && (
                <p className={`mt-1 text-[10px] font-black uppercase tracking-wider ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`}>
                  Most creators pick this
                </p>
              )}
              <p className="mt-1 text-xl font-black text-[#d4af37]">
                {plan.priceUsdPerMonth === 0 ? (
                  "$0"
                ) : (
                  <>
                    ${plan.priceUsdPerMonth}
                    <span className={`text-xs font-bold ${muted}`}>/month</span>
                  </>
                )}
              </p>
              {plan.tagline && <p className={`text-[11px] ${muted}`}>{plan.tagline}</p>}
              <p className={`mt-1 text-[11px] ${muted}`}>
                {plan.feePct} platform fee · {plan.aiBoostsPerMonth} AI promotion boosts / month
              </p>
              <ul className={`mt-2 flex-1 space-y-1 text-[11px] ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-1.5">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#d4af37]" /> {f}
                  </li>
                ))}
              </ul>
              {isMine ? (
                <p
                  className={`mt-3 rounded-full border py-1.5 text-center text-[11px] font-black ${
                    isLight ? "border-emerald-700/40 text-emerald-800" : "border-emerald-400/40 text-emerald-300"
                  }`}
                >
                  Your current plan
                </p>
              ) : !paid ? (
                /* A paid member on the Free card: leaving a paid
                   plan is a glide (hold to period end, then back
                   to Free), never an instant switch — the card
                   says so instead of offering a dead door. */
                <p className={`mt-3 text-center text-[11px] ${muted}`}>
                  Leaving a paid plan is a glide, not a switch — your tier holds to the end
                  of the period, then returns to Free.
                </p>
              ) : cta === "coming-soon" ? (
                <button
                  type="button"
                  disabled
                  className="mt-3 rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold opacity-60 bdv-touch-target"
                >
                  {plan.name} — price coming soon
                </button>
              ) : cta === "retry-load" ? (
                <button
                  type="button"
                  data-testid={`world-coach-plan-retry-${plan.tier}`}
                  onClick={() => void loadPlans()}
                  className={`mt-3 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                    isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"
                  }`}
                >
                  Couldn&rsquo;t load plans — tap to retry
                </button>
              ) : (
                <button
                  type="button"
                  data-testid={`world-coach-plan-buy-${plan.tier}`}
                  onClick={() => void checkout(plan)}
                  disabled={busyTier !== null}
                  className={`${goldBtn} mt-3 justify-center px-3 py-1.5 text-xs`}
                >
                  {busyTier === plan.tier ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Crown className="h-3.5 w-3.5" />
                  )}
                  {busyTier === plan.tier
                    ? "Opening checkout…"
                    : isSwitch
                      ? `Switch to ${plan.name} — ${ladderPriceLabel(plan)}`
                      : `Go ${plan.name} — ${ladderPriceLabel(plan)}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {embedded && (
        <div className="mx-auto w-full max-w-md" data-testid="world-coach-plans-embedded">
          <p className={`mb-2 text-center text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            Finish your {embedded.tier === "elite" ? "Elite" : "Pro"} upgrade — right here:
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
            Cancel — no charge
          </button>
        </div>
      )}
      {changePreview && (
        <div
          data-testid="world-coach-plans-change-confirm"
          className={`mx-auto w-full max-w-md rounded-2xl border px-4 py-3 ${
            isLight ? "border-[#7A5A12]/40 bg-white/50" : "border-[#d4af37]/40 bg-[#d4af37]/[0.07]"
          }`}
        >
          <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            Switch to {changePreview.toPlanName}?
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
            <button
              type="button"
              data-testid="world-coach-plans-change-apply"
              onClick={() => void applyChange()}
              disabled={changing}
              className={`${goldBtn} flex-1 justify-center px-3 py-1.5 text-xs`}
            >
              {changing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
              {changing ? "Switching…" : `Yes, switch to ${changePreview.toPlanName}`}
            </button>
            <button
              type="button"
              data-testid="world-coach-plans-change-cancel"
              onClick={() => setChangePreview(null)}
              disabled={changing}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 bdv-touch-target ${
                isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"
              }`}
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {note && <p className={`text-[11px] ${muted}`}>{note}</p>}
      {doorNote && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{doorNote}</p>
      )}
      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
    </div>
  );
}
