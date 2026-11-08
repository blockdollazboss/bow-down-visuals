/**
 * coach-plan-ladder-components — Stack-100 Wave 5 #31 (audit A14)
 * wiring pins for the Coach desk's plan ladder + upgrade door.
 *
 * The desk must (a) read the member's standing from useCreatorTier
 * — the hook every tier display reads — with an honest failed
 * state, never a defaulted Free; (b) build its ladder through the
 * coach-plan-ladder seam off CREATOR_PLANS, gated by the pricing
 * pages' own CTA derivation; (c) drive the SAME upgrade rails the
 * creator-pricing page drives (embedded intent → in-desk form →
 * verify; proration preview → /api/creator-tiers/change) with the
 * shared money-desks-2 verdicts; and (d) build NO off-site door:
 * no hosted checkout, no billing portal, no window.open, no
 * feature "details" pull-ups — where embedded checkout cannot
 * run, the door stops in the desk and says so.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";

/* JOIN SWEEP (phase-2 repair #6): the ladder's strings now resolve
   through worldJoinSweep — the source pins below assert the key
   references, and the catalog test asserts the en values carry the
   exact sentences these pins used to find in the source. */
const SWEEP = (en as { worldJoinSweep: Record<string, string> }).worldJoinSweep;

const desk = readFileSync(
  new URL("../../components/world/native/CoachPlanLadder.tsx", import.meta.url),
  "utf8",
);
const businessDesks = readFileSync(
  new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url),
  "utf8",
);

describe("the standing — read from the entitlement rail, honestly", () => {
  it("reads the current tier through useCreatorTier", () => {
    expect(desk).toContain("useCreatorTier");
    expect(desk).toContain('from "@/hooks/use-creator-tier"');
  });

  it("a tier read that never lands is an error + Retry — never a defaulted Free plan", () => {
    expect(desk).toContain("COACH_LADDER_TIER_STALL_MS");
    expect(desk).toContain("NativeErrorState");
    expect(desk).toContain("onRetry={onRetryTier}");
    expect(desk).toContain('t("worldJoinSweep.coachLoadFailTitle")');
    expect(SWEEP.coachLoadFailTitle).toBe("Your plan wouldn't load");
    /* No fallback dressing anywhere: the standing is never
       defaulted to a tier the rail didn't state. */
    expect(desk).not.toMatch(/\?\?\s*"free"/);
    expect(desk).not.toMatch(/\|\|\s*"free"/);
    expect(desk).not.toMatch(/me\.tier \?\?/);
  });

  it("shows the standing from the rail: status, fee, boosts and period end", () => {
    expect(desk).toContain("me.status");
    expect(desk).toContain("me.feePct");
    expect(desk).toContain("me.currentPeriodEnd");
    expect(desk).toContain("aiBoostsPerMonth");
  });
});

describe("the ladder — the shared source, the pages' CTA derivation", () => {
  it("builds cards through the seam off CREATOR_PLANS (no direct pricing-plans import in the desk)", () => {
    expect(desk).toContain("buildLadderPlans");
    expect(desk).toContain("parsePlanConfigOverlay");
    expect(desk).toContain('from "@/lib/world/coach-plan-ladder"');
    expect(desk).not.toContain('from "@/lib/pricing-plans"');
  });

  it("overlays live config from GET /api/creator-tiers/plans and renders the rail's note verbatim", () => {
    expect(desk).toContain('fetch("/api/creator-tiers/plans")');
    expect(desk).toContain("plansNote(data)");
    expect(desk).toContain("setPlansLoadFailed(true)");
  });

  it("gates every paid door through paidPlanCta — a failed load retries the load, never a checkout", () => {
    expect(desk).toContain("paidPlanCta(plan.priceConfigured, plansLoadFailed)");
    expect(desk).toContain('cta === "retry-load"');
    expect(desk).toContain('t("worldJoinSweep.coachRetryLoad")');
    expect(SWEEP.coachRetryLoad).toBe("Couldn’t load plans — tap to retry");
    expect(desk).toContain('cta === "coming-soon"');
    expect(desk).toContain('t("worldJoinSweep.coachPriceComingSoon"');
    expect(SWEEP.coachPriceComingSoon).toBe("{{name}} — checkout isn't switched on yet");
  });

  it("renders ALL of the shared source's inclusions as labels — no details links out of the World", () => {
    expect(desk).toContain("plan.features.map");
    expect(desk).not.toContain("detailsUrl");
    expect(desk).not.toContain("href");
  });

  it("marks the member's own card and offers no downgrade door on the Free card", () => {
    expect(desk).toContain('t("worldJoinSweep.coachCurrentPlan")');
    expect(SWEEP.coachCurrentPlan).toBe("Your current plan");
    expect(desk).toContain('pricingCardCta("free", me.tier)');
    expect(desk).toContain('t("worldJoinSweep.coachGlideNote")');
    expect(SWEEP.coachGlideNote).toContain("Leaving a paid plan is a glide, not a switch");
  });
});

describe("the upgrade door — the pricing page's embedded rails, in-desk", () => {
  it("starts the subscription intent on the embedded rail, transport-resilient", () => {
    expect(desk).toContain('"/api/embedded-checkout/subscription/intent"');
    expect(desk).toContain("postJsonWithTransportRetry");
    expect(desk).toContain("body: { tier: plan.tier }");
  });

  it("takes its verdicts from the shared money-desks-2 outcomes — every failure stops in the desk", () => {
    expect(desk).toContain("planIntentOutcome(result, plan.name)");
    expect(desk).toContain("planChangeOutcome(result)");
    expect(desk).toContain("setError(outcome.message)");
    expect(desk).toContain("checkoutFailureCopy(err)");
  });

  it("mounts the shared PaymentElement form in the desk and confirms through the /verify twin", () => {
    expect(desk).toContain("EmbeddedPaymentForm");
    expect(desk).toContain('"/api/embedded-checkout/subscription/verify"');
    expect(desk).toContain("paymentIntentId");
    expect(desk).toContain("subscriptionId: embedded.subscriptionId");
    expect(desk).toContain('t("worldJoinSweep.coachCancelNoCharge")');
    expect(SWEEP.coachCancelNoCharge).toBe("Cancel — no charge");
  });

  it("a tier switch confirms on the pinned proration lines, then applies via /api/creator-tiers/change", () => {
    expect(desk).toContain("planChangeChargeLine(changePreview)");
    expect(desk).toContain("planChangeStartLine(changePreview)");
    expect(desk).toContain("PLAN_CHANGE_CLEARS_CANCEL_LINE");
    expect(desk).toContain('"/api/creator-tiers/change"');
    expect(desk).toContain("body: { tier: changePreview.toTier }");
  });

  it("a landed change or purchase re-reads the standing (the parent remounts the body)", () => {
    expect(desk).toContain("onPlanChanged");
    expect(desk).toContain("setReloadKey((k) => k + 1)");
  });
});

describe("NEVER LEAVE THE SITE — no off-site door exists in this desk", () => {
  it("builds no hosted checkout, no billing portal, no new tab", () => {
    expect(desk).not.toContain("window.open");
    expect(desk).not.toContain("planHostedUrl");
    expect(desk).not.toContain("/api/creator-tiers/checkout");
    expect(desk).not.toContain("/api/creator-tiers/portal");
    expect(desk).not.toContain('"/creator-pricing"');
  });

  it("where embedded checkout cannot run, the door stops in the desk and says so", () => {
    expect(desk).toContain("hasStripePublishableKey()");
    expect(desk).toContain('t("worldJoinSweep.coachDoorNote")');
    expect(SWEEP.coachDoorNote).toBe(
      "Plan checkout isn't switched on inside the World right now — your plan is unchanged and nothing was charged.",
    );
  });
});

describe("the mount — docked in the Coach family, after the money/action tracker", () => {
  it("BusinessDesks mounts the ladder section right after MoneyActionTrackerSection", () => {
    expect(businessDesks).toContain(
      'import { CoachPlanLadderSection } from "./CoachPlanLadder";',
    );
    const trackerAt = businessDesks.indexOf("<MoneyActionTrackerSection");
    const ladderAt = businessDesks.indexOf("<CoachPlanLadderSection");
    expect(trackerAt).toBeGreaterThan(-1);
    expect(ladderAt).toBeGreaterThan(trackerAt);
  });

  it("the section carries the ladder test id and card test ids per tier", () => {
    expect(desk).toContain('data-testid="world-coach-plan-ladder"');
    expect(desk).toContain("world-coach-plan-${plan.tier}");
    expect(desk).toContain("world-coach-plan-buy-${plan.tier}");
    expect(desk).toContain('data-testid="world-coach-plans-embedded"');
    expect(desk).toContain('data-testid="world-coach-plans-change-confirm"');
  });
});
