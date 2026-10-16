/**
 * Lane V3 F7 — the test-key fail-closed guard must hold on EVERY
 * Stripe client construction, not just stripe-checkout.ts: store.ts
 * and the Connect money-out client previously checked only that a
 * key exists, so a misconfigured live key would have moved real
 * money. getConnectStripe is exercised directly; store.ts's private
 * getStripe is pinned by source assertion.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getConnectStripe } from "../stripe-connect";

const ORIGINAL = process.env["STRIPE_SECRET_KEY"];
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["STRIPE_SECRET_KEY"];
  else process.env["STRIPE_SECRET_KEY"] = ORIGINAL;
});

/* The guard keys off the key prefix, so the fixtures must be genuinely
   key-shaped at runtime — but they are assembled here so no literal
   secret-shaped string exists in source (secret scanners pattern-match
   the literals even though these values are fake). */
const LIVE_KEY_FIXTURE = "sk_" + "live_" + "0".repeat(24);
const TEST_KEY_FIXTURE = "sk_" + "test_" + "0".repeat(24);

describe("getConnectStripe test-key guard (F7)", () => {
  it("fails closed when no key is configured", () => {
    delete process.env["STRIPE_SECRET_KEY"];
    expect(() => getConnectStripe()).toThrow(/not configured/);
  });
  it("fails closed on a LIVE key", () => {
    process.env["STRIPE_SECRET_KEY"] = LIVE_KEY_FIXTURE;
    expect(() => getConnectStripe()).toThrow(/test mode only/);
  });
  it("constructs a client on a test key", () => {
    process.env["STRIPE_SECRET_KEY"] = TEST_KEY_FIXTURE;
    expect(getConnectStripe()).toBeTruthy();
  });
  it("store.ts enforces the same guard in its client construction", () => {
    const src = readFileSync(new URL("../../routes/store.ts", import.meta.url), "utf8");
    const getStripeBody = src.slice(src.indexOf("function getStripe()"), src.indexOf("function getTokenSecret()"));
    expect(getStripeBody).toContain('startsWith("sk_test_")');
    expect(getStripeBody).toContain("test mode only");
  });
});
