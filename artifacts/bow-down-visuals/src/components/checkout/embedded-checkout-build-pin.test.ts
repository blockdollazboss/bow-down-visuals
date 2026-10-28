/**
 * embedded-checkout-build-pin.test.ts — stack500 lane K.
 *
 * Why this test exists (the failure it pins against): the Oct 28
 * payments gate re-run #2 found every embedded checkout on the live
 * site silently falling back to Stripe's hosted page — shop,
 * storefronts, gift cards, packs, World desks — even though the
 * embedded code was present and its source-string tests all passed.
 * Root cause was on the BUILD side, which no test asserted: the
 * production Dockerfile never declared `VITE_STRIPE_PUBLISHABLE_KEY`
 * as a build arg, so Render's build-arg pass-through could not
 * deliver the key, Vite inlined `undefined`, and
 * `hasStripePublishableKey()` was false in every visitor's browser.
 *
 * This pin covers the build recipe and the runtime gate TOGETHER:
 *  - the repo-root Dockerfile must declare the ARG and pass it
 *    through ENV ahead of the build step;
 *  - the gate in EmbeddedCheckout.tsx must still read that exact
 *    env var, and both mount components must stay gated on it;
 *  - the shop drawer's checkout note must stay mode-aware (on-site
 *    copy only when the gate can open) and every locale must carry
 *    the on-site string.
 *
 * If any of these fail, embedded checkout is broken in production
 * no matter how green the flow tests look.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* This file: artifacts/bow-down-visuals/src/components/checkout/
   Repo root is five levels up. */
const dockerfile = readFileSync(
  join(__dirname, "..", "..", "..", "..", "..", "Dockerfile"),
  "utf8",
);
const gateSrc = readFileSync(join(__dirname, "EmbeddedCheckout.tsx"), "utf8");
const shopSrc = readFileSync(join(__dirname, "..", "..", "pages", "shop.tsx"), "utf8");
const localesDir = join(__dirname, "..", "..", "locales");

describe("build config — Stripe publishable key reaches the bundle", () => {
  it("Dockerfile declares VITE_STRIPE_PUBLISHABLE_KEY as a build arg", () => {
    expect(dockerfile).toMatch(/^ARG VITE_STRIPE_PUBLISHABLE_KEY=/m);
  });

  it("Dockerfile passes the arg through ENV before the build step", () => {
    const envPassthrough = dockerfile.indexOf(
      "VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY",
    );
    expect(envPassthrough).toBeGreaterThan(-1);
    const buildStep = dockerfile.indexOf("pnpm run build");
    expect(buildStep).toBeGreaterThan(-1);
    expect(envPassthrough).toBeLessThan(buildStep);
  });

  it("the other VITE_* build vars keep the same declared pattern", () => {
    for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_LIP_SYNC_ENABLED"]) {
      expect(dockerfile).toMatch(new RegExp(`^ARG ${name}=`, "m"));
      expect(dockerfile).toContain(`${name}=$${name}`);
    }
  });
});

describe("runtime gate — EmbeddedCheckout key check", () => {
  it("hasStripePublishableKey reads the build-time publishable key", () => {
    expect(gateSrc).toContain("export function hasStripePublishableKey()");
    expect(gateSrc).toContain("import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY");
    expect(gateSrc).toContain(
      "return Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)",
    );
  });

  it("both mount components stay gated on the key check", () => {
    const nullGates = gateSrc.match(/if \(!hasStripePublishableKey\(\)\) return null;/g) ?? [];
    /* EmbeddedPaymentForm + EmbeddedSessionCheckout. If a future
       component mounts Stripe without the gate, this count dropping
       (or the gate disappearing) is the tripwire. */
    expect(nullGates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("shop drawer — checkout note follows the gate", () => {
  it("renders the on-site note only when the embedded form can mount", () => {
    expect(shopSrc).toContain(
      'hasStripePublishableKey() ? "shop.checkoutNoteOnSite" : "shop.checkoutNote"',
    );
  });

  it("every locale carries the on-site checkout note", () => {
    const localeFiles = readdirSync(localesDir).filter((f) => f.endsWith(".json"));
    expect(localeFiles.length).toBeGreaterThan(0);
    for (const file of localeFiles) {
      const parsed = JSON.parse(readFileSync(join(localesDir, file), "utf8")) as {
        shop?: { checkoutNoteOnSite?: unknown };
      };
      expect(
        typeof parsed.shop?.checkoutNoteOnSite,
        `${file} is missing shop.checkoutNoteOnSite`,
      ).toBe("string");
      expect((parsed.shop?.checkoutNoteOnSite as string).length).toBeGreaterThan(0);
    }
  });
});
