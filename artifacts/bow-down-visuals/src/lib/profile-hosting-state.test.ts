/**
 * profile-hosting-state.test.ts — the Hosting card's render derivation
 * (Stack-200 wave A5, money census item 5).
 *
 * The three states the door must never get wrong:
 *   - no plan        → the buy state (price + embedded checkout action),
 *                      or the honest not-switched-on state when the
 *                      rail isn't configured — never a dead button;
 *   - hosting active → the active state (own subscription, period end);
 *   - Elite          → "included with Elite" — entitled with NO buy
 *                      state at all: an Elite member must never be
 *                      offered a second charge for what their plan
 *                      already includes (the rail 409s it server-side;
 *                      the door must not even render the offer).
 * Plus the honesty states around them: signed-out pitch, load-failed
 * (a failed load never dresses up as a plan state), no-profile, and
 * the admin exemption.
 */
import { describe, expect, it } from "vitest";
import {
  hostingCardState,
  type HostingMeView,
  type HostingPlanView,
} from "./profile-hosting-state";

const PLAN: HostingPlanView = {
  name: "Hosting",
  tagline: "Your page is your website — on your own domain, with clean branding, hosted by us.",
  features: [{ label: "Your own custom domain on your profile page", detailsUrl: "/creator-pricing#feature-site" }],
  priceUsdPerMonth: 9,
  includedWithTier: "elite",
  priceConfigured: true,
  available: true,
};

function me(over: Partial<HostingMeView> = {}): HostingMeView {
  return {
    hostingEntitled: false,
    hostingStatus: null,
    hostingSource: null,
    includedWithElite: false,
    currentPeriodEnd: null,
    cleanBranding: false,
    plan: PLAN,
    ...over,
  };
}

describe("hostingCardState — the three me-states", () => {
  it("no plan → buy: the $9/mo embedded checkout offer", () => {
    const s = hostingCardState({ signedIn: true, phase: "ready", me: me(), plan: PLAN });
    expect(s.kind).toBe("buy");
    if (s.kind === "buy") expect(s.me.plan.priceUsdPerMonth).toBe(9);
  });

  it("no plan + checkout not configured → not-switched-on (price shows, nothing to pay)", () => {
    const dark = { ...PLAN, priceConfigured: false, available: false };
    const s = hostingCardState({ signedIn: true, phase: "ready", me: me({ plan: dark }), plan: dark });
    expect(s.kind).toBe("not-switched-on");
  });

  it("hosting active → hosting-active with its period end", () => {
    const s = hostingCardState({
      signedIn: true,
      phase: "ready",
      me: me({
        hostingEntitled: true,
        hostingStatus: "active",
        hostingSource: "hosting",
        currentPeriodEnd: "2026-12-06T00:00:00.000Z",
        cleanBranding: true,
      }),
      plan: PLAN,
    });
    expect(s.kind).toBe("hosting-active");
    if (s.kind === "hosting-active") expect(s.me.currentPeriodEnd).toContain("2026-12-06");
  });

  it("Elite → elite-included, never buy — even if the plan is purchasable for others", () => {
    const s = hostingCardState({
      signedIn: true,
      phase: "ready",
      me: me({ hostingEntitled: true, hostingStatus: "active", hostingSource: "elite", includedWithElite: true }),
      plan: PLAN,
    });
    expect(s.kind).toBe("elite-included");
    expect(s.kind).not.toBe("buy");
  });

  it("Elite flagged by includedWithElite alone still resolves included", () => {
    const s = hostingCardState({
      signedIn: true,
      phase: "ready",
      me: me({ hostingEntitled: true, includedWithElite: true }),
      plan: PLAN,
    });
    expect(s.kind).toBe("elite-included");
  });
});

describe("hostingCardState — the honesty states around them", () => {
  it("admin exemption → admin-entitled, no buy", () => {
    const s = hostingCardState({
      signedIn: true,
      phase: "ready",
      me: me({ hostingEntitled: true, hostingStatus: "active", hostingSource: "admin" }),
      plan: PLAN,
    });
    expect(s.kind).toBe("admin-entitled");
  });

  it("signed out → the pitch state with the public plan", () => {
    const s = hostingCardState({ signedIn: false, phase: "loading", me: null, plan: PLAN });
    expect(s.kind).toBe("signed-out");
    if (s.kind === "signed-out") expect(s.plan?.priceUsdPerMonth).toBe(9);
  });

  it("loading stays loading — no plan state is invented mid-load", () => {
    expect(hostingCardState({ signedIn: true, phase: "loading", me: null, plan: null }).kind).toBe("loading");
  });

  it("a FAILED load reads load-failed — never dressed as buy or active", () => {
    expect(hostingCardState({ signedIn: true, phase: "failed", me: null, plan: PLAN }).kind).toBe("load-failed");
    expect(hostingCardState({ signedIn: true, phase: "ready", me: null, plan: PLAN }).kind).toBe("load-failed");
  });

  it("no creator profile → no-profile (Hosting runs your page — make it first)", () => {
    expect(hostingCardState({ signedIn: true, phase: "no-profile", me: null, plan: PLAN }).kind).toBe("no-profile");
  });

  it("an own Hosting subscription wins over the not-configured flag (already bought is already on)", () => {
    const dark = { ...PLAN, priceConfigured: false, available: false };
    const s = hostingCardState({
      signedIn: true,
      phase: "ready",
      me: me({ hostingEntitled: true, hostingStatus: "active", hostingSource: "hosting", plan: dark }),
      plan: dark,
    });
    expect(s.kind).toBe("hosting-active");
  });
});
