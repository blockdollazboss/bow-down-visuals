/**
 * Connect payout door on /earnings (stack400 lane 5) — source contract.
 *
 * The Oct 28 gate run proved the gap live: seller D's /earnings showed
 * "Pending payout $34.99" with line items and NO way to start Stripe
 * Connect setup, see a Connect state, or cash out — onboarding had only
 * ever happened outside the site UI. The backend was already complete
 * (onboard/refresh/status/payout/payouts); this contract pins the door:
 *  - /earnings mounts the card under the pending-payout balance;
 *  - the card drives the existing /api/connect/* rail, nothing new;
 *  - all four server states have a seller-facing surface, and
 *    action_needed shows Stripe's own reasons;
 *  - copy is honest that bank setup is Stripe-hosted (seller setup,
 *    not a buyer checkout) and payouts move only when the seller asks;
 *  - styling is theme-aware (Earnings exists in light AND dark) — no
 *    hardcoded white-on-dark classes like the Store Dashboard card.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("earnings page docks the payout door", () => {
  const page = read("../../pages/earnings.tsx");
  it("imports and mounts ConnectPayoutCard", () => {
    expect(page).toContain('from "@/components/earnings/ConnectPayoutCard"');
    expect(page).toContain("<ConnectPayoutCard");
  });
  it("mounts it after the pending-payout balance it acts on", () => {
    const pendingIdx = page.indexOf("<PendingPayoutCard");
    const doorIdx = page.indexOf("<ConnectPayoutCard");
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(doorIdx).toBeGreaterThan(pendingIdx);
  });
});

describe("ConnectPayoutCard drives the existing connect rail", () => {
  const src = read("./ConnectPayoutCard.tsx");
  it("reads status and payout history", () => {
    expect(src).toContain('fetch("/api/connect/status"');
    expect(src).toContain('fetch("/api/connect/payouts"');
  });
  it("starts setup via onboard and continues via refresh", () => {
    expect(src).toContain('"/api/connect/onboard"');
    expect(src).toContain('"/api/connect/refresh"');
    expect(src).toContain("window.location.href = data.url");
  });
  it("cashes out through the seller-initiated payout route", () => {
    expect(src).toContain('fetch("/api/connect/payout"');
  });
  it("adds no new API surface", () => {
    expect(src).not.toContain("/api/connect/login-link");
  });
});

describe("ConnectPayoutCard covers the server state machine", () => {
  const src = read("./ConnectPayoutCard.tsx");
  it("renders all four states", () => {
    expect(src).toContain('"not_started"');
    expect(src).toContain('"action_needed"');
    expect(src).toContain('"pending"');
    expect(src).toContain('"verified"');
  });
  it("shows Stripe's own action-needed reasons", () => {
    expect(src).toContain("status.actionNeeded.map");
  });
  it("gates the cash-out button on readiness and the minimum", () => {
    expect(src).toContain("status.payoutsEnabled && status.pendingCents >= status.minPayoutCents");
  });
  it("has honest non-fake states: load failure and no-profile", () => {
    expect(src).toContain('data-testid="connect-payout-failed"');
    expect(src).toContain('data-testid="connect-payout-noprofile"');
    expect(src).toContain('href="/choose-artist"');
  });
});

describe("ConnectPayoutCard copy + theming honesty", () => {
  const src = read("./ConnectPayoutCard.tsx");
  it("says bank setup is Stripe-hosted and is not a checkout", () => {
    expect(src).toContain("Stripe&apos;s secure pages");
    expect(src).toContain("not a checkout");
  });
  it("says payouts move only when the seller asks", () => {
    expect(src).toContain("nothing moves on its own");
  });
  it("uses theme-aware classes, never hardcoded white-on-dark", () => {
    expect(src).toContain("bg-card");
    expect(src).toContain("text-muted-foreground");
    expect(src).not.toContain("text-white");
    expect(src).not.toContain("border-white/");
    expect(src).not.toContain("bg-white/");
  });
});
