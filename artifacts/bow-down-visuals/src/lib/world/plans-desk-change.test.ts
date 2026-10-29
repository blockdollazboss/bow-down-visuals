/**
 * plans-desk-change — stack600 PlansDesk tier-change pins.
 *
 * The gap (flagged by the stack600 plan-tier-change lane): the
 * embedded subscription intent now answers a subscriber who picks a
 * DIFFERENT tier with 200 { mode: "change", changePreview } — the
 * 2D pricing page lands that answer on a priced confirm panel and
 * applies the swap via POST /creator-tiers/change. The desk's
 * planIntentOutcome did not know that shape: it fell into the
 * OK-with-no-secret branch and stopped honestly (never a wrong
 * charge), but a walker in the World could not complete an
 * upgrade/downgrade in-world — a fullscreen-law / VR-parity gap.
 * The fix teaches the classifier the change shape, renders the
 * preview's pinned numbers in an in-desk confirm panel (the 2D
 * flow's copy, verbatim), and applies through the same change
 * endpoint — all inside the station sheet. These tests pin the
 * verdict + copy behaviorally and the desk's wiring structurally.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PLAN_CHANGE_CLEARS_CANCEL_LINE,
  planChangeChargeLine,
  planChangeOutcome,
  planChangeStartLine,
  planIntentOutcome,
  type PlanChangePreview,
} from "./money-desks-2";

const plansDesk = readFileSync(
  new URL("../../components/world/native/PlansDesk.tsx", import.meta.url),
  "utf8",
);

/** The intent's changePreview for a Pro → Elite upgrade, shaped
 *  exactly like the server's TierChangePreviewView. */
const upgradePreview = {
  fromTier: "pro",
  fromPlanName: "Pro",
  toTier: "elite",
  toPlanName: "Elite",
  toPriceUsdPerMonth: 29,
  amountDueTodayCents: 1233,
  creditCents: 0,
  currency: "usd",
  effective: "immediate",
  renewalDate: "2026-11-28T12:00:00.000Z",
  clearsPendingCancel: false,
};

const upgradeParsed: PlanChangePreview = {
  fromTier: "pro",
  fromPlanName: "Pro",
  toTier: "elite",
  toPlanName: "Elite",
  amountDueTodayCents: 1233,
  creditCents: 0,
  currency: "usd",
  renewalDate: "2026-11-28T12:00:00.000Z",
  clearsPendingCancel: false,
};

const downgradeParsed: PlanChangePreview = {
  fromTier: "elite",
  fromPlanName: "Elite",
  toTier: "pro",
  toPlanName: "Pro",
  amountDueTodayCents: 0,
  creditCents: 850,
  currency: "usd",
  renewalDate: "2026-11-28T12:00:00.000Z",
  clearsPendingCancel: true,
};

describe("planIntentOutcome — the tier-change answer routes to a confirm", () => {
  it("a mode:\"change\" answer carries the preview's pinned numbers verbatim", () => {
    const out = planIntentOutcome(
      {
        ok: true,
        status: 200,
        data: {
          success: true,
          mode: "change",
          tier: "elite",
          fromTier: "pro",
          subscriptionId: "sub_123",
          changePreview: upgradePreview,
        },
      },
      "Elite",
    );
    expect(out).toEqual({ kind: "change", preview: upgradeParsed });
  });

  it("the clears-pending-cancel flag rides through for the disclosure line", () => {
    const out = planIntentOutcome(
      {
        ok: true,
        status: 200,
        data: {
          success: true,
          mode: "change",
          tier: "pro",
          fromTier: "elite",
          subscriptionId: "sub_123",
          changePreview: { ...upgradePreview, toTier: "pro", clearsPendingCancel: true },
        },
      },
      "Pro",
    );
    expect(out.kind).toBe("change");
    if (out.kind !== "change") throw new Error("expected change outcome");
    expect(out.preview.clearsPendingCancel).toBe(true);
  });

  it("a mode:\"change\" answer with NO preview is the honest nothing-charged stop", () => {
    const out = planIntentOutcome(
      { ok: true, status: 200, data: { success: true, mode: "change", tier: "elite" } },
      "Elite",
    );
    expect(out.kind).toBe("error");
    if (out.kind !== "error") throw new Error("expected error outcome");
    expect(out.message).toContain("nothing was charged");
  });

  it("a mode:\"change\" answer with a malformed preview is the honest stop", () => {
    const out = planIntentOutcome(
      {
        ok: true,
        status: 200,
        data: {
          success: true,
          mode: "change",
          changePreview: { ...upgradePreview, amountDueTodayCents: "1233" },
        },
      },
      "Elite",
    );
    expect(out.kind).toBe("error");
    if (out.kind !== "error") throw new Error("expected error outcome");
    expect(out.message).toContain("nothing was charged");
  });

  it("the same-tier 409 shows the server's already-on-tier line", () => {
    const out = planIntentOutcome(
      {
        ok: false,
        status: 409,
        data: { error: "ALREADY_ON_TIER", message: "You're already on the Elite tier." },
      },
      "Elite",
    );
    expect(out).toEqual({ kind: "error", message: "You're already on the Elite tier." });
  });
});

describe("plan change confirm copy — the 2D flow's words, the preview's numbers", () => {
  it("an upgrade names the prorated charge to the saved card today", () => {
    expect(planChangeChargeLine(upgradeParsed)).toBe(
      "Your saved card will be charged $12.33 today — the prorated difference between Pro and Elite for the rest of this billing period.",
    );
  });

  it("a downgrade charges $0 today and names the credit toward future invoices", () => {
    expect(planChangeChargeLine(downgradeParsed)).toBe(
      "Nothing is charged today. The unused time on Elite becomes a $8.50 credit toward your next invoices.",
    );
  });

  it("a change that nets to zero says only that nothing is charged today", () => {
    expect(planChangeChargeLine({ ...upgradeParsed, amountDueTodayCents: 0 })).toBe(
      "Nothing is charged today.",
    );
  });

  it("the start line keeps the renewal date the preview pinned", () => {
    expect(planChangeStartLine(upgradeParsed)).toBe(
      "Elite starts right away — same subscription, same card, and your renewal date stays Nov 28, 2026.",
    );
  });

  it("the start line falls back to the same-renewal-date wording when none is pinned", () => {
    expect(planChangeStartLine({ ...upgradeParsed, renewalDate: null })).toBe(
      "Elite starts right away — same subscription, same card, same renewal date.",
    );
  });

  it("the clears-pending-cancel disclosure is the 2D flow's line", () => {
    expect(PLAN_CHANGE_CLEARS_CANCEL_LINE).toBe(
      "You had a cancellation pending. Switching plans clears it — you're staying, so your plan keeps renewing.",
    );
  });
});

describe("planChangeOutcome — the apply verdict", () => {
  it("a landed change is done, with the charged numbers the response reports", () => {
    const out = planChangeOutcome({
      ok: true,
      status: 200,
      data: { changed: true, tier: "elite", amountDueTodayCents: 1233, creditCents: 0 },
    });
    expect(out).toEqual({
      kind: "done",
      alreadyApplied: false,
      amountDueTodayCents: 1233,
      creditCents: 0,
    });
  });

  it("an already-applied repeat (double-click) is still done, never an error", () => {
    const out = planChangeOutcome({
      ok: true,
      status: 200,
      data: { changed: true, alreadyApplied: true, tier: "elite" },
    });
    expect(out).toEqual({
      kind: "done",
      alreadyApplied: true,
      amountDueTodayCents: 0,
      creditCents: 0,
    });
  });

  it("a server failure shows the route's own message in-desk", () => {
    const out = planChangeOutcome({
      ok: false,
      status: 502,
      data: { error: "Couldn't change your plan: Your card was declined." },
    });
    expect(out).toEqual({
      kind: "error",
      message: "Couldn't change your plan: Your card was declined.",
    });
  });

  it("the change endpoint's same-tier 409 shows the already-on-tier line", () => {
    const out = planChangeOutcome({
      ok: false,
      status: 409,
      data: { error: "You're already on the Elite tier.", code: "ALREADY_ON_TIER" },
    });
    expect(out).toEqual({ kind: "error", message: "You're already on the Elite tier." });
  });

  it("a server error with no message names the HTTP status + nothing charged", () => {
    const out = planChangeOutcome({ ok: false, status: 500, data: {} });
    expect(out.kind).toBe("error");
    if (out.kind !== "error") throw new Error("expected error outcome");
    expect(out.message).toContain("(HTTP 500)");
    expect(out.message).toContain("nothing was charged");
  });

  it("an OK answer that did not apply a change is the honest nothing-charged stop", () => {
    const out = planChangeOutcome({ ok: true, status: 200, data: { success: true } });
    expect(out.kind).toBe("error");
    if (out.kind !== "error") throw new Error("expected error outcome");
    expect(out.message).toContain("nothing was charged");
  });
});

describe("PlansDesk wiring — the change completes inside the desk", () => {
  it("the intent's change outcome lands on desk state, not an error", () => {
    expect(plansDesk).toContain('outcome.kind === "change"');
    expect(plansDesk).toContain("setChangePreview(outcome.preview)");
  });

  it("confirm posts the change endpoint with the confirmed preview's tier", () => {
    expect(plansDesk).toContain('"/api/creator-tiers/change"');
    expect(plansDesk).toContain("body: { tier: changePreview.toTier }");
    expect(plansDesk).toContain("planChangeOutcome(result)");
    expect(plansDesk).toContain("checkoutFailureCopy(err)");
  });

  it("the confirm panel renders the pinned lines in the sheet", () => {
    expect(plansDesk).toContain('data-testid="world-plans-change-confirm"');
    expect(plansDesk).toContain('data-testid="world-plans-change-apply"');
    expect(plansDesk).toContain('data-testid="world-plans-change-cancel"');
    expect(plansDesk).toContain("planChangeChargeLine(changePreview)");
    expect(plansDesk).toContain("planChangeStartLine(changePreview)");
    expect(plansDesk).toContain("PLAN_CHANGE_CLEARS_CANCEL_LINE");
  });

  it("applyChange never leaves the World: no new tab, no hosted rail", () => {
    const start = plansDesk.indexOf("const applyChange");
    const end = plansDesk.indexOf("const openPortal");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = plansDesk.slice(start, end);
    expect(body).not.toContain("window.open");
    expect(body).not.toContain("/api/creator-tiers/checkout");
    expect(body).not.toContain("/api/creator-tiers/portal");
  });

  it("Not now only clears the confirm — it posts nothing", () => {
    expect(plansDesk).toContain("onClick={() => setChangePreview(null)}");
  });
});
