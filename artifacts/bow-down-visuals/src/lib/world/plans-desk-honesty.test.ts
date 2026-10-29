/**
 * plans-desk-honesty — stack600 PlansDesk honesty pins.
 *
 * The defect (flagged by the stack500 subscription lane): the
 * World's PlansDesk fired the subscription intent with a bare fetch
 * and fell through to the HOSTED Stripe rail on ANY failure — the
 * buyer was silently walked off the site and never shown the error
 * (the Gate #2 intent 502s were invisible in-world). The fix mirrors
 * the creator-pricing page: the intent rides
 * postJsonWithTransportRetry, its verdict comes from the pure
 * planIntentOutcome, and every failure STOPS in the desk with the
 * honest line. These tests pin the verdict behaviorally and the
 * desk's wiring structurally.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planIntentOutcome } from "./money-desks-2";

const plansDesk = readFileSync(
  new URL("../../components/world/native/PlansDesk.tsx", import.meta.url),
  "utf8",
);

describe("planIntentOutcome — failure stops with the honest error", () => {
  it("a server 502 shows the route's own nothing-charged message", () => {
    const out = planIntentOutcome(
      {
        ok: false,
        status: 502,
        data: { error: "Stripe couldn't start checkout. Nothing was charged — try again." },
      },
      "Pro",
    );
    expect(out).toEqual({
      kind: "error",
      message: "Stripe couldn't start checkout. Nothing was charged — try again.",
    });
  });

  it("a server error with no message names the HTTP status + nothing charged", () => {
    const out = planIntentOutcome({ ok: false, status: 502, data: {} }, "Pro");
    expect(out.kind).toBe("error");
    if (out.kind !== "error") throw new Error("expected error outcome");
    expect(out.message).toContain("(HTTP 502)");
    expect(out.message).toContain("nothing was charged");
  });

  it("a non-JSON-shaped error body still names the HTTP status", () => {
    const out = planIntentOutcome({ ok: false, status: 500, data: null }, "Elite");
    expect(out.kind).toBe("error");
    if (out.kind !== "error") throw new Error("expected error outcome");
    expect(out.message).toContain("(HTTP 500)");
    expect(out.message).toContain("nothing was charged");
  });

  it("the 409 already-subscribed answer shows the server's manage message, not a hosted detour", () => {
    const out = planIntentOutcome(
      {
        ok: false,
        status: 409,
        data: {
          error: "ALREADY_SUBSCRIBED",
          message: "You already have an active plan — manage it from your billing settings.",
        },
      },
      "Elite",
    );
    expect(out).toEqual({
      kind: "error",
      message: "You already have an active plan — manage it from your billing settings.",
    });
  });

  it("an OK answer with no usable secret is an error, never a reason to try another rail", () => {
    const out = planIntentOutcome({ ok: true, status: 200, data: { success: true } }, "Pro");
    expect(out.kind).toBe("error");
    if (out.kind !== "error") throw new Error("expected error outcome");
    expect(out.message).toContain("nothing was charged");
  });

  it("an OK answer missing the subscriptionId is an error", () => {
    const out = planIntentOutcome(
      { ok: true, status: 200, data: { clientSecret: "cs_test_123" } },
      "Pro",
    );
    expect(out.kind).toBe("error");
  });
});

describe("planIntentOutcome — success proceeds embedded", () => {
  it("a secret + subscriptionId mounts the embedded form with the server label", () => {
    const out = planIntentOutcome(
      {
        ok: true,
        status: 200,
        data: {
          clientSecret: "cs_test_123",
          subscriptionId: "sub_123",
          label: "Pro — $12/month",
        },
      },
      "Pro",
    );
    expect(out).toEqual({
      kind: "embedded",
      clientSecret: "cs_test_123",
      subscriptionId: "sub_123",
      label: "Pro — $12/month",
    });
  });

  it("the label falls back to the plan name when the server sends none", () => {
    const out = planIntentOutcome(
      {
        ok: true,
        status: 200,
        data: { clientSecret: "cs_test_123", subscriptionId: "sub_123" },
      },
      "Elite",
    );
    expect(out).toEqual({
      kind: "embedded",
      clientSecret: "cs_test_123",
      subscriptionId: "sub_123",
      label: "Elite",
    });
  });

  it("an in-place tier change answer is the changed outcome", () => {
    const out = planIntentOutcome(
      { ok: true, status: 200, data: { changed: true } },
      "Elite",
    );
    expect(out).toEqual({ kind: "changed" });
  });
});

describe("PlansDesk wiring — no silent fall-through to the hosted rail", () => {
  it("the intent rides the pricing page's transport-resilient helper", () => {
    expect(plansDesk).toContain("postJsonWithTransportRetry(");
    expect(plansDesk).toContain('"/api/embedded-checkout/subscription/intent"');
    expect(plansDesk).toContain("planIntentOutcome(result, plan.name)");
    expect(plansDesk).toContain("checkoutFailureCopy(err)");
  });

  it("the old silent fall-through is gone", () => {
    expect(plansDesk).not.toContain("Any intent failure falls through");
    expect(plansDesk).not.toContain("fall through to the rail below");
    expect(plansDesk).not.toContain("/* fall through to the hosted rail */");
    expect(plansDesk).not.toContain('fetch("/api/embedded-checkout/subscription/intent"');
  });

  it("the error outcome is set BEFORE the hosted checkout call in checkout()", () => {
    const errIdx = plansDesk.indexOf("setError(outcome.message)");
    const hostedIdx = plansDesk.indexOf('fetch("/api/creator-tiers/checkout"');
    expect(errIdx).toBeGreaterThan(-1);
    expect(hostedIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeLessThan(hostedIdx);
    /* Every intent outcome returns inside the key-present branch —
       the embedded mount, the changed note, the transport catch and
       the error set each end in a return before the hosted rail. */
    const branch = plansDesk.slice(
      plansDesk.indexOf("if (hasStripePublishableKey())"),
      hostedIdx,
    );
    expect(branch).toContain('outcome.kind === "embedded"');
    expect(branch).toContain('outcome.kind === "changed"');
    expect(branch.match(/return;/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("the embedded success path is unchanged: the shared form mounts and verifies", () => {
    expect(plansDesk).toContain("<EmbeddedPaymentForm");
    expect(plansDesk).toContain('fetch("/api/embedded-checkout/subscription/verify"');
    expect(plansDesk).toContain('data-testid="world-plans-embedded"');
  });
});
