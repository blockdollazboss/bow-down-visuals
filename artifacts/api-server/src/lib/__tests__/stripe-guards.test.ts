/**
 * Lane V3 F7 + payments D2 — the test-key fail-closed guard must hold
 * on EVERY Stripe client construction in the API server. All direct
 * construction now lives in lib/stripe-client.ts; domain wrappers and
 * route-local helpers delegate to it. The registry below walks the
 * whole source tree so a future unguarded construction fails here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getConnectStripe } from "../stripe-connect";
import {
  buildCheckoutSessionIdempotencyKey,
  createGuardedStripeClient,
} from "../stripe-client";

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
    expect(getStripeBody).toContain("createGuardedStripeClient()");
  });
});

describe("shared Stripe client guard (D2)", () => {
  it("fails closed when no key is configured", () => {
    delete process.env["STRIPE_SECRET_KEY"];
    expect(() => createGuardedStripeClient()).toThrow(/not configured/);
  });
  it("fails closed on a LIVE key", () => {
    process.env["STRIPE_SECRET_KEY"] = LIVE_KEY_FIXTURE;
    expect(() => createGuardedStripeClient()).toThrow(/test mode only/);
  });
  it("constructs a client on a test key", () => {
    process.env["STRIPE_SECRET_KEY"] = TEST_KEY_FIXTURE;
    expect(createGuardedStripeClient()).toBeTruthy();
  });
});

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function walkTsFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...walkTsFiles(`${dir}/${entry.name}`, rel));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(rel);
    }
  }
  return out;
}

describe("Stripe construction registry (D2)", () => {
  const files = walkTsFiles(SRC_ROOT);
  const read = (rel: string) => readFileSync(`${SRC_ROOT}/${rel}`, "utf8");

  it("allows direct Stripe construction ONLY in the shared guarded module", () => {
    const constructors = files.filter((rel) => read(rel).includes("new Stripe("));
    expect(constructors).toEqual(["lib/stripe-client.ts"]);
  });

  it("allows no dynamic Stripe import that could bypass the shared module", () => {
    const dynamicImports = files.filter((rel) => /import\(\s*["']stripe["']\s*\)/.test(read(rel)));
    expect(dynamicImports).toEqual([]);
  });

  it("every Stripe-client caller routes through a guarded entry point", () => {
    const callers = [
      "lib/creator-tier-sync.ts",
      "lib/stripe-checkout.ts",
      "lib/stripe-connect.ts",
      "lib/stripe-webhook.ts",
      "routes/creator-tiers.ts",
      "routes/express-pay.ts",
      "routes/generate/branding-shop.ts",
      "routes/generate/shops.ts",
      "routes/generate/shoutouts.ts",
      "routes/generate/sponsors.ts",
      "routes/generate/tip-jar.ts",
      "routes/profile-hosting.ts",
      "routes/store.ts",
      "routes/storefront.ts",
      "routes/stripe-connect.ts",
      "routes/stripe-payments.ts",
    ];
    for (const rel of callers) {
      expect(read(rel), rel).toMatch(/createGuardedStripeClient|getCheckoutStripe|getConnectStripe/);
    }
  });
});

describe("checkout session idempotency keys (D4)", () => {
  const scope = {
    memberId: "member-1",
    rail: "credit-pack",
    purchaseIntent: { priceId: "price_123", credits: 5000, completedPurchaseCount: 2 },
  };

  it("is deterministic and insensitive to intent property order", () => {
    const a = buildCheckoutSessionIdempotencyKey(scope);
    const b = buildCheckoutSessionIdempotencyKey({
      ...scope,
      purchaseIntent: { completedPurchaseCount: 2, credits: 5000, priceId: "price_123" },
    });
    expect(b).toBe(a);
    expect(a).toMatch(/^checkout:credit-pack:member-1:[0-9a-f]{32}$/);
  });

  it("changes when the member, rail, or purchase sequence changes", () => {
    const base = buildCheckoutSessionIdempotencyKey(scope);
    expect(buildCheckoutSessionIdempotencyKey({ ...scope, memberId: "member-2" })).not.toBe(base);
    expect(buildCheckoutSessionIdempotencyKey({ ...scope, rail: "membership" })).not.toBe(base);
    expect(
      buildCheckoutSessionIdempotencyKey({
        ...scope,
        purchaseIntent: { ...scope.purchaseIntent, completedPurchaseCount: 3 },
      }),
    ).not.toBe(base);
  });

  it("pack checkout and the shared helper both send the key to Stripe", () => {
    const packSrc = readFileSync(new URL("../../routes/stripe-payments.ts", import.meta.url), "utf8");
    expect(packSrc).toContain("countCompletedCreditPurchases");
    expect(packSrc).toContain("buildCheckoutSessionIdempotencyKey");
    expect(packSrc).toContain("{ idempotencyKey }");

    const helperSrc = readFileSync(new URL("../stripe-checkout.ts", import.meta.url), "utf8");
    expect(helperSrc).toContain("buildCheckoutSessionIdempotencyKey(input.idempotency)");
    expect(helperSrc).toContain("{ idempotencyKey }");
  });
});
